import http, { type Server } from "node:http";
import { ManifestSchema } from "@open-game-system/ogs-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type DevServer, onLan, startDevServer } from "./server";

/** What the `ogs dev` server answers, route by route, and the fake app each phone gets. */
let dev: DevServer | null = null;
const servers: Server[] = [];
afterEach(async () => {
  await dev?.close();
  dev = null;
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});

async function game(): Promise<string> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<head></head>");
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}

const manifestFor = (origin: string, tvUrl?: string) =>
  ManifestSchema.parse({
    appId: "fixture-game",
    name: "Fixture Game",
    shape: "couch",
    tv: "optional",
    startUrl: `${origin}/play?x=1#h`,
    ...(tvUrl ? { tvUrl } : {}),
    art: { tile: "/tile.png" },
  });

async function start(opts: { tvUrl?: string; lan?: string | null; phones?: number } = {}) {
  const origin = await game();
  const manifest = manifestFor(origin, opts.tvUrl);
  dev = await startDevServer({
    manifest,
    startUrl: manifest.startUrl,
    tvUrl: opts.tvUrl,
    port: 0,
    phones: opts.phones ?? 1,
    lan: opts.lan ?? null,
    host: "127.0.0.1",
  });
  return { dev, origin };
}

const bridgeOf = (html: string): unknown =>
  JSON.parse(/var cfg = (.*);\n/.exec(html)?.[1] ?? "null");
const configOf = (html: string): unknown =>
  JSON.parse(
    /<script id="ogs-dev-config" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1] ??
      "null",
  );

describe("the ogs dev server's routes", { timeout: 20_000 }, () => {
  it("/ and /index.html: the harness, never cached", async () => {
    const { dev } = await start();
    for (const path of ["/", "/index.html", "/?q=1"]) {
      const res = await fetch(`${dev.url}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toMatch(/^<!doctype html>/);
    }
  });

  it("the JWKS: JSON, to anyone, never cached", async () => {
    const { dev } = await start();
    const res = await fetch(dev.jwksUrl);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(dev.jwksUrl).toBe(`${dev.url}/.well-known/jwks.json`);
  });

  it("anything else: 404 Not found", async () => {
    const { dev } = await start();
    const res = await fetch(`${dev.url}/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("Not found");
  });

  it("the harness config: the TV page (or none), phones numbered from 1, the JWKS URL", async () => {
    const { dev } = await start({ tvUrl: "http://localhost:9/tv", phones: 2 });
    const cfg = configOf(await (await fetch(dev.url)).text());
    expect(cfg).toMatchObject({
      appId: "fixture-game",
      name: "Fixture Game",
      tvUrl: "http://localhost:9/tv",
      startLanUrl: null,
      startLanQr: null,
      jwksUrl: `${dev.url}/.well-known/jwks.json`,
      phones: [
        { phone: 1, name: "Ada", url: dev.phoneUrls[0], lanUrl: null, lanQr: null },
        { phone: 2, name: "Sam", url: dev.phoneUrls[1], lanUrl: null, lanQr: null },
      ],
    });
    await dev.close();
    const room = await start();
    expect(configOf(await (await fetch(room.dev.url)).text())).toMatchObject({ tvUrl: null });
  });

  it("each phone's fake app: its profile, the dev TV, a push handle", async () => {
    const { dev } = await start({ tvUrl: "http://localhost:9/tv" });
    const bridge = bridgeOf(await (await fetch(dev.phoneUrls[0])).text());
    expect(bridge).toMatchObject({
      phone: 1,
      stores: {
        profile: { status: "ready", profile: { name: "Ada", handle: "ada" } },
        ogs: { reported: [] },
        notifications: { answer: null, last: null },
        cast: {
          isAvailable: true,
          devices: [{ id: "ogs-dev-tv", name: "ogs dev TV", type: "chromecast" }],
          session: {
            status: "connected",
            deviceId: "ogs-dev-tv",
            deviceName: "ogs dev TV",
            streamSessionId: null,
          },
          error: null,
          viewUrl: "http://localhost:9/tv",
        },
      },
    });
    if (typeof bridge !== "object" || bridge === null || !("pushHandle" in bridge))
      throw new Error("no push handle");
    expect(bridge.pushHandle).toMatch(/^ph_devdev-[0-9a-f]{8}-1$/);
    expect(JSON.stringify(bridge)).toMatch(/"sessionId":"dev-couch-[0-9a-f]{8}"/);
  });

  it("a room game's phones have no TV page yet", async () => {
    const { dev } = await start();
    expect(bridgeOf(await (await fetch(dev.phoneUrls[0])).text())).toMatchObject({
      stores: { cast: { viewUrl: null } },
    });
  });

  it("phone URLs keep the start URL's path, query and hash; on the LAN too", async () => {
    const { dev } = await start({ lan: "10.0.0.5", phones: 2 });
    const ports = dev.phoneUrls.map((u) => new URL(u).port);
    expect(dev.phoneUrls).toEqual(ports.map((p) => `http://localhost:${p}/play?x=1#h`));
    expect(dev.lanUrls).toEqual({
      harness: `http://10.0.0.5:${new URL(dev.url).port}`,
      phones: ports.map((p) => `http://10.0.0.5:${p}/play?x=1#h`),
      start: expect.stringMatching(/^http:\/\/10\.0\.0\.5:\d+\/play\?x=1#h$/),
    });
    const cfg = configOf(await (await fetch(dev.url)).text());
    expect(cfg).toMatchObject({
      phones: [
        { lanUrl: `http://10.0.0.5:${ports[0]}/play?x=1#h` },
        { lanUrl: `http://10.0.0.5:${ports[1]}/play?x=1#h` },
      ],
      startLanQr: expect.stringMatching(/^data:image\/gif;base64,/),
    });
  });

  it("listens on every interface unless told", async () => {
    const origin = await game();
    const manifest = manifestFor(origin);
    dev = await startDevServer({
      manifest,
      startUrl: manifest.startUrl,
      port: 0,
      phones: 1,
      lan: null,
    });
    const port = new URL(dev.url).port;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
  });

  it("a phone port that's taken: closes what it opened and fails", async () => {
    const busy = http.createServer();
    servers.push(busy);
    await new Promise<void>((r) => busy.listen(0, "127.0.0.1", () => r()));
    const addr = busy.address();
    const busyPort = typeof addr === "object" && addr ? addr.port : 0;
    const origin = await game();
    const manifest = manifestFor(origin);
    await expect(
      startDevServer({
        manifest,
        startUrl: manifest.startUrl,
        port: busyPort - 1,
        phones: 1,
        lan: null,
        host: "127.0.0.1",
      }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
    // The harness it bound first is closed again.
    const again = http.createServer();
    servers.push(again);
    await new Promise<void>((resolve, reject) => {
      again.once("error", reject);
      again.listen(busyPort - 1, "127.0.0.1", () => resolve());
    });
  });

  it("puts every local name on the LAN", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"])
      expect(onLan(`http://${host}:5173/p`, "10.0.0.2")).toBe("http://10.0.0.2:5173/p");
  });
});
