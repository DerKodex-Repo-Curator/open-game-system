import http, { type Server } from "node:http";
import { join } from "node:path";
import { verifyOgsToken } from "@open-game-system/profile-kit/server";
import { build } from "esbuild";

const page = (title: string, id: string, script: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><script type="module" src="${script}"></script></head><body><h1>${title}</h1><pre id="${id}">waiting</pre><pre id="verified"></pre><pre id="paused"></pre></body></html>`;

/**
 * The fixture game: a TV page and a phone page bundled from profile-kit's browser entry, and a
 * game server that verifies the TV's token with `verifyOgsToken` against `process.env.OGS_JWKS_URL`.
 */
export async function serveFixtureGame(): Promise<{ origin: string; server: Server }> {
  const bundle = async (file: string) => {
    const out = await build({
      entryPoints: [join(import.meta.dirname, file)],
      bundle: true,
      format: "esm",
      platform: "browser",
      write: false,
    });
    return out.outputFiles[0].text;
  };
  const js: Record<string, string> = {
    "/tv.js": await bundle("tv.ts"),
    "/phone.js": await bundle("phone.ts"),
  };
  const server = http.createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/play") {
      res.writeHead(200, { "content-type": "text/html", "x-frame-options": "DENY" });
      res.end(page("Phone", "profile", "/phone.js"));
    } else if (path === "/tv") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(page("TV", "session", "/tv.js"));
    } else if (js[path]) {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(js[path]);
    } else if (path === "/verify" && req.method === "POST") {
      let token = "";
      req.on("data", (c: Buffer) => {
        token += c.toString("utf8");
      });
      req.on("end", async () => {
        const claims = await verifyOgsToken(token, {
          appId: "fixture-game",
          jwksUrl: process.env.OGS_JWKS_URL,
        });
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(
          claims
            ? `verified for ${claims.aud}: ${(claims.players ?? []).map((p) => p.name).join(",")}`
            : "rejected",
        );
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  const addr = server.address();
  return { origin: `http://localhost:${typeof addr === "object" && addr ? addr.port : 0}`, server };
}
