import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Io, run } from "../../../packages/cli/src/cli";
import app from "../src/index";
import { generateApiKey } from "../src/lib/api-keys";
import { openTestD1, type TestD1 } from "./support/d1";
import { p8Pem } from "./support/keys";

/**
 * The seam between the ogs CLI and the API (docs/acceptance/2026-10-18-ogs-cli.feature): the real
 * CLI, the real routes, a real local D1. opengame.org's link file is the API's (what its Pages
 * Function passes through); the game's TV page is a stand-in.
 */
const API = "https://api.test";
let d1: TestD1;
let key: string;
let dir: string;
let out: string[];
let err: string[];

beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  const k = await generateApiKey();
  key = k.key;
  await d1.db
    .prepare("INSERT INTO game_api_keys (id, app_id, prefix, key_hash, scope, created_at) VALUES ('k-rc', 'rocket-crew', ?, ?, 'notifications:send', 1)")
    .bind(k.prefix, k.hash)
    .run();
  dir = mkdtempSync(join(tmpdir(), "ogs-seam-"));
  out = [];
  err = [];
});

const env = { OGS_JWT_SECRET: "cli-seam-secret", PUSH_KEY_SECRET: "cli-seam-push-key-secret" };
const io = (): Io => ({
  env: { OGS_API: API, OGS_SITE: "https://site.test", OGS_CONFIG_DIR: dir },
  stdout: (s) => out.push(s),
  stderr: (s) => err.push(s),
  readFile: (p) => readFileSync(p, "utf8"),
  fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === API) return app.request(`${url.pathname}${url.search}`, init, { DB: d1.db, ...env });
    if (url.href === "https://site.test/.well-known/apple-app-site-association")
      return app.request("/api/v1/apps/apple-app-site-association", {}, { DB: d1.db, ...env });
    return new Response("<html>", { status: 200 });
  },
});

describe("ogs against the API", () => {
  it("logs in, registers the iOS app, uploads the APNs key and the doctor passes", async () => {
    expect(await run(["login", "--app", "rocket-crew", "--key", key], io())).toBe(0);
    expect(await run(["apps", "register", "--ios", "tv.rocketcrew.app", "--team-id", "34S957HD77"], io())).toBe(0);
    const p8 = join(dir, "AuthKey_ABC123DEFG.p8");
    writeFileSync(p8, await p8Pem());
    expect(await run(["push", "credentials", "--ios", p8, "--key-id", "ABC123DEFG", "--team-id", "34S957HD77"], io())).toBe(0);
    expect(out.join("\n")).toContain("ios: configured (key ABC123DEFG, team 34S957HD77, tv.rocketcrew.app)");
    out = [];
    const code = await run(["doctor"], io());
    expect(out.join("\n")).toContain("ok   site.test apple-app-site-association lists 34S957HD77.tv.rocketcrew.app for /play/rocket-crew/*");
    expect(err).toEqual([]);
    expect(code).toBe(0);
    const row = await d1.db.prepare("SELECT key_id, team_id FROM app_push_credentials WHERE app_id = 'rocket-crew'").first();
    expect(row).toEqual({ key_id: "ABC123DEFG", team_id: "34S957HD77" });
  }, 30_000);

  it("a key for another game can't log in for this one", async () => {
    expect(await run(["login", "--app", "codebreakers", "--key", key], io())).toBe(1);
    expect(err.join("\n")).toContain("wrong_game");
  });
});
