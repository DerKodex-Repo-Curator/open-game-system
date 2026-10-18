import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { type Io, run } from "../../../packages/cli/src/cli";
import { saveCredentials } from "../../../packages/cli/src/io";
import app from "../src/index";
import { generateApiKey } from "../src/lib/api-keys";
import type { Probe } from "../src/lib/manifest-check";
import { catalogueEntries } from "../src/routes/catalogue-entries";
import type { Env } from "../src/types";
import { openTestD1, type TestD1 } from "./support/d1";

/**
 * The seam between ogs manifest check / ogs publish and the API
 * (docs/acceptance/2026-10-18-ogs-developer-tool.feature, the catalogue scenarios): the real CLI, the
 * real routes, a real local D1. The game's pages are a stand-in probe; nothing reaches the network.
 */
const API = "https://api.test";
const ADMIN = "cli-catalogue-admin-token";
let d1: TestD1;
let ccKey: string;
let cbKey: string;
let dir: string;
let out: string[];
let err: string[];
let pages: Record<string, { status: number; headers?: Record<string, string> }>;

beforeAll(async () => {
  d1 = await openTestD1();
}, 60_000);
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  const cc = await generateApiKey();
  const cb = await generateApiKey();
  ccKey = cc.key;
  cbKey = cb.key;
  await d1.db.batch(
    (
      [
        ["k-cc", "comet-catch", cc],
        ["k-cb", "codebreakers", cb],
      ] as const
    ).map(([id, appId, k]) =>
      d1.db
        .prepare(
          "INSERT INTO game_api_keys (id, app_id, prefix, key_hash, scope, created_at) VALUES (?, ?, ?, ?, 'notifications:send', 1)",
        )
        .bind(id, appId, k.prefix, k.hash),
    ),
  );
  dir = mkdtempSync(join(tmpdir(), "ogs-cli-catalogue-"));
  out = [];
  err = [];
  pages = {
    "https://comet.example/": { status: 200 },
    "https://comet.example/tv": { status: 200 },
  };
});

const probe: Probe = async (url) => {
  const page = pages[url];
  return page ? { status: page.status, headers: new Headers(page.headers) } : null;
};
const env = { OGS_JWT_SECRET: "cli-catalogue-secret", OGS_ADMIN_TOKEN: ADMIN };
const api = () =>
  new Hono<{ Bindings: Env }>().route("/api/v1", catalogueEntries(probe)).route("/", app);
const request = (path: string, init?: RequestInit) =>
  api().request(path, init, { DB: d1.db, ...env });
const io = (): Io => ({
  env: { OGS_API: API, OGS_CONFIG_DIR: dir },
  stdout: (s) => out.push(s),
  stderr: (s) => err.push(s),
  readFile: (p) => readFileSync(p, "utf8"),
  fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === API) return request(`${url.pathname}${url.search}`, init);
    throw new TypeError(`no network in tests: ${url.href}`);
  },
});

const COMET = {
  appId: "comet-catch",
  name: "Comet Catch",
  shape: "couch",
  tv: "required",
  startUrl: "https://comet.example/",
  tvUrl: "https://comet.example/tv",
  roles: [
    { id: "pilot", label: "Pilot", audience: "grownup" },
    { id: "catcher", label: "Catcher", audience: "kid" },
  ],
  art: {
    tile: "https://comet.example/art/tile.jpg",
    icon: "https://comet.example/art/icon.png",
    cover: "https://comet.example/art/cover.jpg",
    logo: "https://comet.example/art/logo.png",
    heroClean: "https://comet.example/art/hero.jpg",
  },
};
const manifest = (m: unknown) => {
  const path = join(dir, "ogs.manifest.json");
  writeFileSync(path, JSON.stringify(m));
  return path;
};
const admin = (appId: string, action: "approve" | "reject", body?: unknown) =>
  request(`/api/v1/admin/catalogue-entries/${appId}/${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const catalogueIds = async () =>
  z
    .array(z.object({ appId: z.string() }))
    .parse(await (await request("/api/v1/catalogue")).json())
    .map((g) => g.appId);
const login = async (appId: string, key: string) => {
  expect(await run(["login", "--app", appId, "--key", key], io())).toBe(0);
  out = [];
};

describe("ogs manifest check against the API", { timeout: 20_000 }, () => {
  it("a valid manifest whose startUrl answers 200 and whose tvUrl can be framed passes", async () => {
    expect(await run(["manifest", "check", manifest(COMET)], io())).toBe(0);
    expect(out).toEqual([
      "checked: startUrl 200, tvUrl 200, framed by the OGS launcher: yes",
      "valid: comet-catch has no issues",
    ]);
    expect(err).toEqual([]);
  });

  it("names the warnings: no kid role, no art kit, an http startUrl, a TV page that can't be framed", async () => {
    pages["http://comet.example/"] = { status: 200 };
    pages["https://comet.example/tv"] = {
      status: 200,
      headers: { "X-Frame-Options": "SAMEORIGIN" },
    };
    const m = {
      ...COMET,
      startUrl: "http://comet.example/",
      roles: [{ id: "a", label: "A", audience: "little" }],
      art: { tile: "https://comet.example/art/tile.jpg" },
    };
    expect(await run(["manifest", "check", manifest(m)], io())).toBe(0);
    const codes = out.filter((l) => l.startsWith("warning ")).map((l) => l.split(/[ :]/)[1]);
    expect(codes).toEqual([
      "start_url_not_https",
      "missing_art",
      "no_kid_role",
      "tv_page_not_frameable",
    ]);
    expect(out.at(-1)).toBe("valid: comet-catch has no issues (4 warnings)");
  });

  it("a start URL that doesn't answer is named", async () => {
    delete pages["https://comet.example/"];
    expect(await run(["manifest", "check", manifest(COMET)], io())).toBe(0);
    expect(out).toContain("warning start_url_unreachable: startUrl didn't answer within 5 s");
  });

  it("a manifest missing startUrl lists the issue at path startUrl and exits 1", async () => {
    const { startUrl: _s, ...noStart } = COMET;
    expect(await run(["manifest", "check", manifest(noStart)], io())).toBe(1);
    expect(err[0]).toMatch(/^issue startUrl: /);
  });
});

describe("ogs publish against the API", { timeout: 20_000 }, () => {
  it("submits the entry for review; --status prints it; an approved entry is in the catalogue", async () => {
    await login("comet-catch", ccKey);
    expect(await run(["publish", manifest(COMET)], io())).toBe(0);
    expect(out[0]).toMatch(/^comet-catch: pending review \(submitted \d{4}-/);
    const row = await d1.db
      .prepare("SELECT status FROM catalogue_entries WHERE app_id = 'comet-catch'")
      .first();
    expect(row).toEqual({ status: "pending" });
    expect(await catalogueIds()).not.toContain("comet-catch");

    out = [];
    expect(await run(["publish", "--status"], io())).toBe(0);
    expect(out[0]).toMatch(/^comet-catch: pending review/);
    expect(out[1]).toBe("pending: Comet Catch (https://comet.example/)");

    expect((await admin("comet-catch", "approve")).status).toBe(200);
    expect(await catalogueIds()).toContain("comet-catch");
    out = [];
    expect(await run(["publish", "--status"], io())).toBe(0);
    expect(out[0]).toMatch(/^comet-catch: live in the catalogue \(approved /);
    expect(out[1]).toBe("live: Comet Catch (https://comet.example/)");
  });

  it("a rejected entry stays out, with the admin's note in its status", async () => {
    await login("comet-catch", ccKey);
    expect(await run(["publish", manifest(COMET)], io())).toBe(0);
    expect(
      (await admin("comet-catch", "reject", { note: "The TV page shows a QR code when framed" }))
        .status,
    ).toBe(200);
    expect(await catalogueIds()).not.toContain("comet-catch");
    out = [];
    expect(await run(["publish", "--status"], io())).toBe(0);
    expect(out[0]).toMatch(/^comet-catch: rejected \(reviewed /);
    expect(out[1]).toBe("note: The TV page shows a QR code when framed");
  });

  it("only the game's key publishes its entry: rocket-crew with Codebreakers' key is 403 wrong_game", async () => {
    saveCredentials(io(), { currentApp: "rocket-crew", apps: { "rocket-crew": { key: cbKey } } });
    expect(await run(["publish", manifest({ ...COMET, appId: "rocket-crew" })], io())).toBe(1);
    expect(err).toEqual(["wrong_game: This API key belongs to another game"]);
  });

  it("a manifest for another game than the login is app_id_mismatch", async () => {
    await login("comet-catch", ccKey);
    expect(await run(["publish", manifest({ ...COMET, appId: "comet-crash" })], io())).toBe(1);
    expect(err[0]).toMatch(/^app_id_mismatch: /);
  });
});
