import {
  type Claims,
  ScreenCreatedSchema,
  ScreenStateSchema,
} from "@open-game-system/ogs-protocol";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import app from "../src/index";
import { issueToken } from "../src/lib/identity";
import { SCREEN_CLAIM_TTL_MS } from "../src/lib/screens";
import { openTestD1, type TestD1 } from "./support/d1";

// Acceptance: 2026-10-18-cast-chrome-none.feature, "A browser TV pairs by code and shows the game".
// A white-label app casts chromeless (chrome=none&app=<appId>): the screen is told the app.
const SECRET = "screen-app-secret";
let d1: TestD1;

beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  await d1.db.batch([
    d1.db.prepare(
      "INSERT INTO profiles (id, handle, name, sticker) VALUES ('dana', 'dana', 'Dana', 'bear')",
    ),
    d1.db
      .prepare(
        "INSERT INTO couch_sessions (id, host_profile_id, code, tv_name, created_at) VALUES ('s1', 'dana', 'NT9WPH', 'TV', ?)",
      )
      .bind(Date.now()),
  ]);
});

const env = () => ({ DB: d1.db, OGS_JWT_SECRET: SECRET });
const token = (claims: Omit<Claims, "exp">) =>
  issueToken(claims, SECRET, { now: Date.now(), ttlSeconds: 600 });
const phone = () => token({ sub: "dana", did: "dana-phone", kind: "phone" });
const launcher = () => token({ sub: "dana", did: "launcher-s1", kind: "launcher", sid: "s1" });

async function call(
  method: string,
  path: string,
  opts: { auth?: string; secret?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth) headers.Authorization = `Bearer ${opts.auth}`;
  if (opts.secret) headers["X-Screen-Secret"] = opts.secret;
  const res = await app.request(
    `/api/v1/screens${path}`,
    { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) },
    env(),
  );
  const text = await res.text();
  return { status: res.status, body: text ? z.unknown().parse(JSON.parse(text)) : null };
}

async function claimedScreen() {
  const s = ScreenCreatedSchema.parse((await call("POST", "")).body);
  await call("POST", "/claim", { auth: await phone(), body: { code: s.code } });
  return s;
}
const stateOf = async (s: { screenId: string; secret: string }) =>
  ScreenStateSchema.parse((await call("GET", `/${s.screenId}`, { secret: s.secret })).body);

describe("a browser screen and a white-label app's chromeless cast", () => {
  it("shows the app with the launcher token", async () => {
    const s = await claimedScreen();
    const lt = await launcher();
    const shown = await call("POST", `/${s.screenId}/show`, {
      auth: await phone(),
      body: { token: lt, app: "rocket-crew" },
    });
    expect(shown.status).toBe(204);
    expect(await stateOf(s)).toEqual({ code: s.code, show: { token: lt, app: "rocket-crew" } });
  });

  it("a later cast without an app shows the whole launcher again", async () => {
    const s = await claimedScreen();
    const lt = await launcher();
    const auth = await phone();
    await call("POST", `/${s.screenId}/show`, { auth, body: { token: lt, app: "rocket-crew" } });
    await call("POST", `/${s.screenId}/show`, { auth, body: { token: lt } });
    expect(await stateOf(s)).toEqual({ code: s.code, show: { token: lt } });
  });

  it("stopping forgets the app", async () => {
    const s = await claimedScreen();
    const auth = await phone();
    await call("POST", `/${s.screenId}/show`, {
      auth,
      body: { token: await launcher(), app: "rocket-crew" },
    });
    await call("POST", `/${s.screenId}/stop`, { auth });
    expect(await stateOf(s)).toEqual({ code: s.code, show: null });
    const rows = await d1.db
      .prepare("SELECT COUNT(*) AS n FROM screen_apps")
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("refuses an app that isn't a catalogue id", async () => {
    const s = await claimedScreen();
    const r = await call("POST", `/${s.screenId}/show`, {
      auth: await phone(),
      body: { token: await launcher(), app: "Rocket Crew" },
    });
    expect(r.status).toBe(400);
  });
});

describe("a dead screen's app", () => {
  afterEach(() => vi.restoreAllMocks());

  it("goes with the screen when its code is taken again", async () => {
    const s = await claimedScreen();
    await call("POST", `/${s.screenId}/show`, {
      auth: await phone(),
      body: { token: await launcher(), app: "rocket-crew" },
    });
    await d1.db
      .prepare("UPDATE screens SET last_used_at = ? WHERE id = ?")
      .bind(Date.now() - SCREEN_CLAIM_TTL_MS - 1000, s.screenId)
      .run();
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const real = crypto.getRandomValues.bind(crypto);
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      if (array instanceof Uint8Array && array.length === 6) {
        array.set([...s.code].map((ch) => alphabet.indexOf(ch)));
        return array;
      }
      return real(array);
    });
    const again = ScreenCreatedSchema.parse((await call("POST", "")).body);
    expect(again.code).toBe(s.code);
    const rows = await d1.db
      .prepare("SELECT COUNT(*) AS n FROM screen_apps")
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });
});
