import http, { type Server } from "node:http";
import {
  GameTokenSchema,
  LauncherToGameSchema,
  ManifestSchema,
} from "@open-game-system/ogs-protocol";
import { verifyOgsToken } from "@open-game-system/profile-kit/server";
import { afterEach, describe, expect, it } from "vitest";
import { type DevServer, onLan, startDevServer } from "./server";

/** A tiny game: an HTML start page that forbids framing, a script, a redirect. */
async function fakeGame(): Promise<{
  origin: string;
  server: Server;
  seen: http.IncomingHttpHeaders[];
}> {
  const seen: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    if (req.url === "/play") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "x-frame-options": "DENY",
        "content-security-policy": "frame-ancestors 'none'; script-src 'self'",
      });
      res.end(
        '<!doctype html><html><head><title>Play</title><script src="/app.js"></script></head><body>hi</body></html>',
      );
    } else if (req.url === "/app.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end("console.log('game')");
    } else if (req.url === "/go") {
      res.writeHead(302, { location: `http://${req.headers.host}/play?from=go` });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { origin: `http://127.0.0.1:${port}`, server, seen };
}

const manifestFor = (origin: string) =>
  ManifestSchema.parse({
    appId: "fixture-game",
    name: "Fixture Game",
    shape: "couch",
    tv: "required",
    startUrl: `${origin}/play`,
    tvUrl: `${origin}/tv`,
    art: { tile: "/tile.png" },
  });

const configOf = (html: string): unknown => {
  const m = /<script id="ogs-dev-config" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(m?.[1] ?? "null");
};

let dev: DevServer | null = null;
let game: Server | null = null;
afterEach(async () => {
  await dev?.close();
  game?.close();
  dev = null;
  game = null;
});

async function setup(lan: string | null = null) {
  const g = await fakeGame();
  game = g.server;
  const manifest = manifestFor(g.origin);
  dev = await startDevServer({
    manifest,
    startUrl: manifest.startUrl,
    tvUrl: manifest.tvUrl,
    port: 0,
    phones: 2,
    lan,
    host: "127.0.0.1",
  });
  return { dev, game: g };
}

describe("ogs dev server", { timeout: 20_000 }, () => {
  it("frames the TV page with an ogs:start whose token the game server verifies with OGS_JWKS_URL", async () => {
    const { dev } = await setup();
    const html = await (await fetch(dev.url)).text();
    const cfg = configOf(html);
    const start = LauncherToGameSchema.parse(
      typeof cfg === "object" && cfg && "start" in cfg ? cfg.start : null,
    );
    if (start.type !== "ogs:start") throw new Error("not a start");
    expect(html).toContain('id="tv"');
    expect(start.players).toHaveLength(2);

    // What a game's server does: OGS_JWKS_URL=http://localhost:<port>/.well-known/jwks.json
    process.env.OGS_JWKS_URL = `${dev.url}/.well-known/jwks.json`;
    expect(process.env.OGS_JWKS_URL).toMatch(/^http:\/\/localhost:\d+\/\.well-known\/jwks\.json$/);
    const claims = await verifyOgsToken(start.token, {
      appId: "fixture-game",
      jwksUrl: process.env.OGS_JWKS_URL,
    });
    expect(GameTokenSchema.parse(claims)).toMatchObject({
      aud: "fixture-game",
      iss: dev.url,
      players: start.players,
    });
    expect(
      await verifyOgsToken(start.token, { appId: "other-game", jwksUrl: process.env.OGS_JWKS_URL }),
    ).toBeNull();
  });

  it("serves the JWKS to any origin", async () => {
    const { dev } = await setup();
    const res = await fetch(dev.jwksUrl);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body: unknown = await res.json();
    expect(body).toMatchObject({ keys: [{ kty: "EC", crv: "P-256", alg: "ES256" }] });
  });

  it("signs a fresh TV token on every harness load", async () => {
    const { dev } = await setup();
    const tokenOf = async () => {
      const cfg = configOf(await (await fetch(dev.url)).text());
      const start = LauncherToGameSchema.parse(
        typeof cfg === "object" && cfg && "start" in cfg ? cfg.start : null,
      );
      return start.type === "ogs:start" ? start.token : "";
    };
    expect(await tokenOf()).not.toBe(await tokenOf());
  });

  it("gives each phone its own origin, with the bridge first in <head> and framing allowed", async () => {
    const { dev } = await setup();
    expect(dev.phoneUrls).toHaveLength(2);
    expect(new Set(dev.phoneUrls.map((u) => new URL(u).origin)).size).toBe(2);
    const res = await fetch(dev.phoneUrls[0]);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(res.headers.get("content-security-policy")).toBeNull();
    const html = await res.text();
    expect(html).toMatch(/^<!doctype html><html><head><script data-ogs-dev-bridge>/);
    expect(html).toContain('<script src="/app.js"></script>');
    expect(html).toContain('"handle":"ada"');
    expect(await (await fetch(dev.phoneUrls[1])).text()).toContain('"handle":"sam"');
  });

  it("passes other files through unchanged and sends the game its own Host", async () => {
    const { dev, game } = await setup();
    const res = await fetch(new URL("/app.js", dev.phoneUrls[0]));
    expect(await res.text()).toBe("console.log('game')");
    expect(game.seen.at(-1)?.host).toBe(new URL(game.origin).host);
  });

  it("keeps a redirect on the game's origin inside the phone", async () => {
    const { dev } = await setup();
    const res = await fetch(new URL("/go", dev.phoneUrls[0]), { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${new URL(dev.phoneUrls[0]).origin}/play?from=go`);
  });

  it("says the game isn't running when its server doesn't answer", async () => {
    const { dev } = await setup();
    await new Promise<void>((r) => game?.close(() => r()));
    game = null;
    const res = await fetch(dev.phoneUrls[0]);
    expect(res.status).toBe(502);
    expect(await res.text()).toMatch(/did not answer/);
  });

  it("shows QR codes of the phones and the start URL on the LAN", async () => {
    const { dev, game } = await setup("192.168.1.20");
    const port = new URL(game.origin).port;
    expect(dev.lanUrls?.start).toBe(
      `http://127.0.0.1:${port}/play`.replace("127.0.0.1", "192.168.1.20"),
    );
    const html = await (await fetch(dev.url)).text();
    expect(html).toContain(`http://192.168.1.20:${port}/play`);
    expect(html).toContain(`http://192.168.1.20:${new URL(dev.phoneUrls[0]).port}/play`);
    expect(html.match(/<img src="data:image\/gif;base64,/g)).toHaveLength(3);
  });

  it("puts only localhost URLs on the LAN address", () => {
    expect(onLan("http://localhost:5173/play?x=1", "10.0.0.2")).toBe(
      "http://10.0.0.2:5173/play?x=1",
    );
    expect(onLan("https://game.example.com/", "10.0.0.2")).toBe("https://game.example.com/");
  });
});
