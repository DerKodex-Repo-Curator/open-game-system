import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { type Io, run } from "../../../packages/cli/src/cli";
import { tvStartPath, wsProbe } from "../../../packages/try-kit/src/worker";
import { catalogueFor } from "../src/catalogue";
import app from "../src/index";
import { generateApiKey } from "../src/lib/api-keys";
import { issueToken } from "../src/lib/identity";
import { openTestD1, type TestD1 } from "./support/d1";

/**
 * The seam between `ogs try` / `ogs push send` and the API (docs/acceptance/2026-10-18-ogs-developer-tool.feature,
 * "try / push send"): the real CLI, the real routes, a real local D1. The deploy is a fake process
 * runner that prints what wrangler prints; the API's two try-path checks reach a stand-in Worker made
 * of try-kit's own routes, and Expo is faked at fetch (as in game-push.test.ts). Nothing leaves the machine.
 */
const API = "https://api.test";
const TRY = "https://rocket-crew-try.jon.workers.dev";
const SECRET = "cli-deliver-secret";
const env = { OGS_JWT_SECRET: SECRET };
let d1: TestD1;
let key: string;
let home: string;
let repo: string;
let out: string[];
let err: string[];
let deploys: string[];
let expoCalls: { to: string; title: string; body: string; data?: Record<string, string> }[];

beforeAll(async () => {
  d1 = await openTestD1();
}, 120_000);
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  const k = await generateApiKey();
  key = k.key;
  await d1.db.batch([
    d1.db
      .prepare(
        "INSERT INTO game_api_keys (id, app_id, prefix, key_hash, scope, created_at) VALUES ('k-rc', 'rocket-crew', ?, ?, 'notifications:send', 1)",
      )
      .bind(k.prefix, k.hash),
    d1.db.prepare(
      "INSERT INTO profiles (id, handle, name, sticker) VALUES ('jon', 'jon', 'Jon', 'owl')",
    ),
    d1.db.prepare(
      "INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES ('jon-phone', 'jon', 'phone', 'Phone')",
    ),
    d1.db.prepare(
      "INSERT INTO devices (ogs_device_id, platform, push_token) VALUES ('jon-phone', 'ios', 'ExponentPushToken[jon]')",
    ),
  ]);
  home = mkdtempSync(join(tmpdir(), "ogs-deliver-home-"));
  repo = mkdtempSync(join(tmpdir(), "ogs-deliver-repo-"));
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ scripts: { "deploy:try": "wrangler deploy -c wrangler.try.jsonc" } }),
  );
  writeFileSync(join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  out = [];
  err = [];
  deploys = [];
  expoCalls = [];
  // What the API itself fetches: the try path's checks, and Expo.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.origin === TRY) {
      if (url.pathname === "/")
        return Response.redirect(new URL(tvStartPath(url, "ABCD"), url).href, 302);
      if (url.pathname === "/ws-probe") return wsProbe(req);
      return new Response("not found", { status: 404 });
    }
    if (url.origin === "https://example.com") return new Response("<html>Example Domain</html>");
    if (url.origin === "https://exp.host") {
      const msg = JSON.parse(await req.text());
      expoCalls.push(msg);
      return Response.json({ data: [{ status: "ok", id: "ticket" }] });
    }
    throw new TypeError(`unexpected fetch ${req.url}`);
  });
});
afterEach(() => vi.unstubAllGlobals());

const io = (): Io => ({
  env: { OGS_API: API, OGS_CONFIG_DIR: home },
  cwd: () => repo,
  stdout: (s) => out.push(s),
  stderr: (s) => err.push(s),
  readFile: (p) => readFileSync(p, "utf8"),
  fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== API) throw new TypeError(`the CLI fetched ${url.href}`);
    return app.request(`${url.pathname}${url.search}`, init, { DB: d1.db, ...env });
  },
  exec: async (command) => {
    deploys.push(command);
    return {
      code: 0,
      output: `Uploaded rocket-crew-try (3.21 sec)\nDeployed rocket-crew-try triggers (0.84 sec)\n  ${TRY}\nCurrent Version ID: 0f3c2a8e\n`,
    };
  },
});
const ogs = async (...argv: string[]) => {
  out = [];
  err = [];
  return run(argv, io());
};

/** The developer's own handle: their phone's OGS app said Allow (POST /games/:appId/push-handles). */
async function myHandle() {
  const token = await issueToken({ sub: "jon", did: "jon-phone", kind: "phone" }, SECRET, {
    now: Date.now(),
    ttlSeconds: 60,
  });
  const res = await app.request(
    "/api/v1/games/rocket-crew/push-handles",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    },
    { DB: d1.db, ...env },
  );
  return z.object({ handle: z.string() }).parse(await res.json()).handle;
}

describe("ogs try and ogs push send against the API", { timeout: 20_000 }, () => {
  it("deploys and registers a try path; the catalogue gives the game its tryUrl", async () => {
    expect(await ogs("login", "--app", "rocket-crew", "--key", key)).toBe(0);
    expect(await ogs("try")).toBe(0);
    expect(deploys).toEqual(["pnpm run deploy:try"]);
    expect(out.join("\n")).toContain(`ok   try path ${TRY} registered for rocket-crew`);
    expect(err).toEqual([]);
    const row = await d1.db
      .prepare("SELECT url FROM try_paths WHERE app_id = 'rocket-crew'")
      .first();
    expect(row).toEqual({ url: TRY });
    const games = z
      .array(z.object({ appId: z.string(), tryUrl: z.string().optional() }))
      .parse(await (await app.request("/api/v1/catalogue", {}, { DB: d1.db, ...env })).json());
    expect(games.find((m) => m.appId === "rocket-crew")?.tryUrl).toBe(TRY);
    expect(await ogs("try", "--check-only")).toBe(0);
    expect(deploys).toEqual(["pnpm run deploy:try"]);
  }, 30_000);

  it("a URL that isn't a try path: 422 try_path_not_found saying which check failed", async () => {
    await ogs("login", "--app", "rocket-crew", "--key", key);
    expect(await ogs("try", "--url", "https://example.com", "--check-only")).toBe(1);
    expect(deploys).toEqual([]);
    expect(err.join("\n")).toBe(
      "try_path_not_found: GET https://example.com/ answered 200, not a redirect to a TV page; GET https://example.com/ws-probe answered 200, not 426 (try-kit's wsProbe)",
    );
    expect(await d1.db.prepare("SELECT url FROM try_paths").first()).toBeNull();
  });

  it("a test push to your own handle prints sent; --check lists its surfaces and sends nothing", async () => {
    await ogs("login", "--app", "rocket-crew", "--key", key);
    const handle = await myHandle();
    expect(await ogs("push", "send", "--to", handle, "--check")).toBe(0);
    expect(out).toEqual([
      expect.stringMatching(new RegExp(`^${handle}  ogs \\(last active \\d{4}-\\d\\d-\\d\\dT`)),
    ]);
    expect(expoCalls).toEqual([]);

    const link = new URL(
      "/room/ABCD",
      catalogueFor({}).find((m) => m.appId === "rocket-crew")?.startUrl,
    ).href;
    expect(await ogs("push", "send", "--to", handle, "--title", "Test", "--url", link)).toBe(0);
    expect(out).toEqual([`${handle}  sent`]);
    expect(expoCalls).toEqual([
      expect.objectContaining({
        to: "ExponentPushToken[jon]",
        title: "Test",
        body: "A test push from ogs push send.",
        data: expect.objectContaining({ appId: "rocket-crew", url: link }),
      }),
    ]);
  });

  it("someone else's handle, or a made-up one, is not_permitted and exits 1", async () => {
    await ogs("login", "--app", "rocket-crew", "--key", key);
    expect(await ogs("push", "send", "--to", "ph_madeupmadeupmadeup")).toBe(1);
    expect(out).toEqual(["ph_madeupmadeupmadeup  not_permitted"]);
    expect(await ogs("push", "send", "--to", "ph_madeupmadeupmadeup", "--check")).toBe(1);
    expect(out).toEqual([
      "ph_madeupmadeupmadeup  handle_not_found: No push handle with that id for this game",
    ]);
    expect(expoCalls).toEqual([]);
  });
});
