import { type ChildProcess, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { TestProject } from "vitest/node";
import { newKeyPair } from "./keys";

/**
 * Seam tests run the real Worker (`wrangler dev`) with OGS's key set swapped for a local one, so
 * the tests can sign game tokens the Worker accepts. Both get free ports, so another dev server on
 * the machine can't answer in their place.
 */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const address = probe.address();
  await new Promise<void>((r) => probe.close(() => r()));
  if (!address || typeof address === "string") throw new Error("no free port");
  return address.port;
}

declare module "vitest" {
  export interface ProvidedContext {
    gameUrl: string;
    privateJwk: JsonWebKey;
  }
}

let wrangler: ChildProcess | null = null;
let jwksServer: Server | null = null;

export async function setup(project: TestProject) {
  const { jwks, privateJwk } = await newKeyPair();
  jwksServer = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(jwks));
  });
  await new Promise<void>((r) => jwksServer?.listen(0, "127.0.0.1", r));
  const jwksAddress = jwksServer.address();
  if (!jwksAddress || typeof jwksAddress === "string") throw new Error("JWKS server has no port");
  const jwksUrl = `http://127.0.0.1:${jwksAddress.port}/.well-known/jwks.json`;

  const gamePort = await freePort();
  const gameUrl = process.env.GAME_URL ?? `http://127.0.0.1:${gamePort}`;
  if (!process.env.GAME_URL) {
    wrangler = spawn(
      "pnpm",
      [
        "exec",
        "wrangler",
        "dev",
        "--ip",
        "127.0.0.1",
        "--port",
        String(gamePort),
        "--var",
        `OGS_JWKS_URL:${jwksUrl}`,
      ],
      { stdio: "ignore", detached: true },
    );
    const deadline = Date.now() + 90_000;
    for (;;) {
      try {
        if ((await fetch(`${gameUrl}/tv`)).ok) break;
      } catch {}
      if (Date.now() > deadline) throw new Error(`wrangler dev did not start on ${gameUrl}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  project.provide("gameUrl", gameUrl);
  project.provide("privateJwk", privateJwk);
}

export async function teardown() {
  if (wrangler?.pid) process.kill(-wrangler.pid, "SIGTERM");
  await new Promise<void>((r) => (jwksServer ? jwksServer.close(() => r()) : r()));
}
