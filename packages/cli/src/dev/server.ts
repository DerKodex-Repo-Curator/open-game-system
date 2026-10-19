import http, { type Server } from "node:http";
import { networkInterfaces } from "node:os";
import type { Manifest } from "@open-game-system/ogs-protocol";
import qrcode from "qrcode-generator";
import { bridgeScript, type PhoneBridge } from "./bridge-script";
import {
  type DevCouch,
  fakeCouch,
  phoneClaims,
  profileState,
  startMessage,
  tvClaims,
} from "./couch";
import { type HarnessPhone, harnessHtml } from "./harness";
import { createPhoneProxy } from "./proxy";
import { createDevSigner } from "./tokens";

export type DevOptions = {
  manifest: Manifest;
  /** The phone page (manifest startUrl, or --start-url). */
  startUrl: string;
  /** The TV page (manifest tvUrl, or --tv-url); undefined for a room-based game. */
  tvUrl?: string;
  /** The harness port; phone i (1-based) is on port + i. 0 picks free ports (tests). */
  port: number;
  phones: number;
  /** The machine's LAN address for real phones (null: none). */
  lan: string | null;
  /** Interface to listen on (default all, so real phones reach it). */
  host?: string;
};

export type DevServer = {
  url: string;
  jwksUrl: string;
  phoneUrls: string[];
  lanUrls: { harness: string; phones: string[]; start: string } | null;
  close(): Promise<void>;
};

/** The first IPv4 LAN address (Wi-Fi or Ethernet), or null. */
export function lanAddress(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return null;
}

/** The URL with a localhost host swapped for the LAN address (a real phone can't reach localhost). */
export function onLan(url: string, lan: string): string {
  const u = new URL(url);
  if (["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(u.hostname)) u.hostname = lan;
  return u.toString();
}

export function qrDataUrl(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 2);
}

const listen = (server: Server, port: number, host: string) =>
  new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    });
  });

const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

/** The phone page's path and query on a phone proxy's origin. */
const phonePath = (startUrl: URL) => startUrl.pathname + startUrl.search + startUrl.hash;

/** The harness page for this run: the TV's ogs:start (with its token), each phone, the QR codes. */
function harnessPage(
  opts: DevOptions,
  run: {
    couch: DevCouch;
    token: string;
    iss: string;
    phoneUrls: string[];
    lanPhoneUrls: string[];
  },
): string {
  const phones: HarnessPhone[] = run.couch.players.map((p, i) => ({
    phone: i + 1,
    name: p.name,
    avatar: p.avatar,
    url: run.phoneUrls[i],
    lanUrl: run.lanPhoneUrls[i] ?? null,
    lanQr: run.lanPhoneUrls[i] ? qrDataUrl(run.lanPhoneUrls[i]) : null,
  }));
  const startLanUrl = opts.lan ? onLan(opts.startUrl, opts.lan) : null;
  return harnessHtml({
    appId: opts.manifest.appId,
    name: opts.manifest.name,
    tvUrl: opts.tvUrl ?? null,
    start: startMessage(run.couch, run.token),
    phones,
    startLanUrl,
    startLanQr: startLanUrl ? qrDataUrl(startLanUrl) : null,
    jwksUrl: `${run.iss}/.well-known/jwks.json`,
  });
}

/**
 * `ogs dev`: the harness on `port`, one bridge proxy per phone on the ports after it, and
 * `/.well-known/jwks.json` with this run's key. Tokens are signed fresh on every page load.
 */
export async function startDevServer(opts: DevOptions): Promise<DevServer> {
  const { manifest } = opts;
  const host = opts.host ?? "0.0.0.0";
  const signer = await createDevSigner();
  const couch = fakeCouch(manifest, opts.phones);
  const start = new URL(opts.startUrl);
  const servers: Server[] = [];

  // Bind the harness first: its port fixes the issuer, the JWKS URL and the phone ports.
  let iss = "";
  const phoneUrls: string[] = [];
  const lanPhoneUrls: string[] = [];
  const harness = http.createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/.well-known/jwks.json") {
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(signer.jwks()));
      return;
    }
    if (path === "/" || path === "/index.html") {
      const token = await signer.sign(tvClaims(couch, manifest.appId, iss, Date.now()));
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(harnessPage(opts, { couch, token, iss, phoneUrls, lanPhoneUrls }));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  });
  const port = await listen(harness, opts.port, host);
  servers.push(harness);
  iss = `http://localhost:${port}`;

  try {
    for (let i = 0; i < couch.players.length; i++) {
      const bridge = (): Promise<PhoneBridge> =>
        signer.sign(phoneClaims(couch, i, manifest.appId, iss, Date.now())).then((token) => ({
          phone: i + 1,
          stores: {
            profile: profileState(couch.players[i], token),
            ogs: { reported: [] },
            notifications: { answer: null, last: null },
            cast: {
              isAvailable: true,
              devices: [{ id: "ogs-dev-tv", name: "ogs dev TV", type: "chromecast" }],
              session: {
                status: "connected",
                deviceId: "ogs-dev-tv",
                deviceName: "ogs dev TV",
                sessionId: couch.sid,
                streamSessionId: null,
              },
              error: null,
              viewUrl: opts.tvUrl ?? null,
            },
          },
          pushHandle: `ph_dev${couch.players[i].id.replace(/[^A-Za-z0-9_-]/g, "")}`,
        }));
      const proxy = createPhoneProxy({
        upstream: start,
        script: async () => bridgeScript(await bridge()),
      });
      const phonePort = await listen(proxy.server, opts.port === 0 ? 0 : port + i + 1, host);
      servers.push(proxy.server);
      phoneUrls.push(`http://localhost:${phonePort}${phonePath(start)}`);
      if (opts.lan) lanPhoneUrls.push(`http://${opts.lan}:${phonePort}${phonePath(start)}`);
    }
  } catch (e) {
    await Promise.all(servers.map(close));
    throw e;
  }

  return {
    url: iss,
    jwksUrl: `${iss}/.well-known/jwks.json`,
    phoneUrls,
    lanUrls: opts.lan
      ? {
          harness: `http://${opts.lan}:${port}`,
          phones: lanPhoneUrls,
          start: onLan(opts.startUrl, opts.lan),
        }
      : null,
    close: () => Promise.all(servers.map(close)).then(() => undefined),
  };
}
