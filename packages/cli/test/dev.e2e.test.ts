import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import type { Server } from "node:http";
import { join } from "node:path";
import { type Browser, chromium, type Frame, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveFixtureGame } from "./fixture-game/serve";

/**
 * docs/acceptance/2026-10-18-ogs-developer-tool.feature "Running the game with no device": the
 * built `ogs dev` against the fixture game (profile-kit's browser entry), in Chromium.
 */
const PKG = join(import.meta.dirname, "..");
const PORT = 20_000 + Math.floor(Math.random() * 30_000);
const HARNESS = `http://localhost:${PORT}`;

let game: { origin: string; server: Server };
let cli: ChildProcess;
let output = "";
let browser: Browser;
let page: Page;

const waitFor = async (check: () => boolean, what: string, ms = 30_000) => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

const frameAt = (url: string): Frame => {
  const f = page.frames().find((fr) => fr.url().startsWith(url));
  if (!f) throw new Error(`no frame at ${url}: ${page.frames().map((fr) => fr.url())}`);
  return f;
};
const text = (f: Frame, id: string) => f.locator(`#${id}`).textContent();

beforeAll(async () => {
  execFileSync("pnpm", ["exec", "tsdown"], { cwd: PKG, stdio: "pipe" });
  // What the game's server is told: verify OGS tokens against ogs dev's key set.
  process.env.OGS_JWKS_URL = `${HARNESS}/.well-known/jwks.json`;
  game = await serveFixtureGame();
  cli = spawn(
    process.execPath,
    [
      "dist/bin.mjs",
      "dev",
      "--manifest",
      "test/fixture-game/ogs.manifest.json",
      "--start-url",
      `${game.origin}/play`,
      "--tv-url",
      `${game.origin}/tv`,
      "--port",
      String(PORT),
      "--lan",
      "192.168.50.5",
    ],
    { cwd: PKG, stdio: ["ignore", "pipe", "pipe"] },
  );
  cli.stdout?.on("data", (c: Buffer) => {
    output += c.toString();
  });
  cli.stderr?.on("data", (c: Buffer) => {
    output += c.toString();
  });
  await waitFor(() => output.includes("Ctrl-C stops."), "ogs dev to start");
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(HARNESS);
});

afterAll(async () => {
  await browser?.close();
  cli?.kill("SIGINT");
  game?.server.close();
});

describe("ogs dev, end to end", () => {
  it("frames the TV page and starts it with the fake couch (ogs:start, after its ogs:ready)", async () => {
    const tv = () => frameAt(`${game.origin}/tv`);
    await expect
      .poll(() => text(tv(), "session"), { timeout: 20_000 })
      .toContain('"players":["Ada","Sam"]');
    const log = await page.evaluate(() =>
      (
        window as unknown as { ogsDev: { log: { from: string; message: { type?: string } }[] } }
      ).ogsDev.log.map((e) => `${e.from} ${e.message.type}`),
    );
    expect(log).toContain("launcher → TV ogs:start");
    expect(log).toContain("TV → launcher ogs:ready");
  });

  it("gives the TV a token the game's server verifies with OGS_JWKS_URL=localhost:<port>/.well-known/jwks.json", async () => {
    await expect
      .poll(() => text(frameAt(`${game.origin}/tv`), "verified"), { timeout: 20_000 })
      .toBe("verified for fixture-game: Ada,Sam");
  });

  it("suspends and resumes the TV page from the harness buttons", async () => {
    const tv = () => frameAt(`${game.origin}/tv`);
    await page.click("#suspend");
    await expect.poll(() => text(tv(), "paused"), { timeout: 10_000 }).toBe("true");
    await page.click("#resume");
    await expect.poll(() => text(tv(), "paused"), { timeout: 10_000 }).toBe("false");
  });

  it("shows each phone frame its own OGS profile through the fake app bridge", async () => {
    const phones = await page.evaluate(() =>
      (
        window as unknown as { ogsDev: { config: { phones: { url: string }[] } } }
      ).ogsDev.config.phones.map((p) => p.url),
    );
    expect(phones).toHaveLength(2);
    await expect
      .poll(() => text(frameAt(phones[0]), "profile"), { timeout: 20_000 })
      .toBe("Ada @ada");
    await expect
      .poll(() => text(frameAt(phones[1]), "profile"), { timeout: 20_000 })
      .toBe("Sam @sam");
  });

  it("shows QR codes of the phones and the start URL on the LAN address", async () => {
    const alts = await page
      .locator(".qr img")
      .evaluateAll((imgs) => imgs.map((i) => i.getAttribute("alt")));
    const gamePort = new URL(game.origin).port;
    expect(alts).toEqual([
      `QR code of http://192.168.50.5:${PORT + 1}/play`,
      `QR code of http://192.168.50.5:${PORT + 2}/play`,
      `QR code of http://192.168.50.5:${gamePort}/play`,
    ]);
  });

  it("shows the TV page a phone names with cast SET_VIEW_URL (room-based games), and starts it", async () => {
    const phone = await page.evaluate(
      () =>
        (window as unknown as { ogsDev: { config: { phones: { url: string }[] } } }).ogsDev.config
          .phones[0].url,
    );
    const roomTv = `${game.origin}/tv?room=KQTP`;
    await frameAt(phone).evaluate((url) => {
      window.ReactNativeWebView?.postMessage(
        JSON.stringify({ type: "EVENT", storeKey: "cast", event: { type: "SET_VIEW_URL", url } }),
      );
    }, roomTv);
    await expect
      .poll(() => text(frameAt(roomTv), "session"), { timeout: 20_000 })
      .toContain('"players":["Ada","Sam"]');
  });

  it("stops on Ctrl-C with exit 0", async () => {
    const exited = new Promise<number | null>((r) => cli.once("exit", (code) => r(code)));
    cli.kill("SIGINT");
    expect(await exited).toBe(0);
  });
});
