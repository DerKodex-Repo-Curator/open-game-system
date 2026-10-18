import { type ChildProcess, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { TestProject } from "vitest/node";
import { newKeyPair } from "./keys";

/**
 * Seam tests run the real Worker (`wrangler dev`) with OGS's key set swapped for a local one, so
 * the tests can sign game tokens the Worker accepts.
 */
const GAME_PORT = 8797;
const JWKS_PORT = 8831;

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
  await new Promise<void>((r) => jwksServer?.listen(JWKS_PORT, r));

  const gameUrl = process.env.GAME_URL ?? `http://localhost:${GAME_PORT}`;
  if (!process.env.GAME_URL) {
    wrangler = spawn(
      "pnpm",
      [
        "exec",
        "wrangler",
        "dev",
        "--port",
        String(GAME_PORT),
        "--var",
        `OGS_JWKS_URL:http://localhost:${JWKS_PORT}/.well-known/jwks.json`,
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
