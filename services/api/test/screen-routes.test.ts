import {
  type Claims,
  ScreenClaimedSchema,
  ScreenCreatedSchema,
  ScreenStateSchema,
} from "@open-game-system/ogs-protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import app from "../src/index";
import { issueToken } from "../src/lib/identity";
import { SCREEN_PAIR_TTL_MS } from "../src/lib/screens";
import { openTestD1, type TestD1 } from "./support/d1";

// Acceptance: 2026-10-17-browser-tv.feature. A browser on the TV (a laptop on HDMI, a smart TV's
// browser) is a screen: it shows a code, a phone claims it, and the phone's cast shows the launcher
// there. The screen itself has no profile: it holds a secret the API gave it.
const SECRET = "screen-routes-secret";
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
    d1.db.prepare(
      "INSERT INTO profiles (id, handle, name, sticker) VALUES ('sam', 'sam', 'Sam', 'owl')",
    ),
    d1.db
      .prepare(
        "INSERT INTO couch_sessions (id, host_profile_id, code, tv_name, created_at) VALUES ('s1', 'dana', 'NT9WPH', 'Browser TV', ?)",
      )
      .bind(Date.now()),
  ]);
});

const env = () => ({ DB: d1.db, OGS_JWT_SECRET: SECRET });
const token = (claims: Omit<Claims, "exp">) =>
  issueToken(claims, SECRET, { now: Date.now(), ttlSeconds: 600 });
const phone = (sub: string) => token({ sub, did: `${sub}-phone`, kind: "phone" });
const launcher = (sub: string, sid: string) =>
  token({ sub, did: `launcher-${sid}`, kind: "launcher", sid });
const Body = z.record(z.string(), z.unknown());
const errorCode = (b: unknown) =>
  z.object({ error: z.object({ code: z.string() }) }).parse(b).error.code;

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
  return { status: res.status, body: text ? Body.parse(JSON.parse(text)) : null };
}

async function newScreen() {
  const r = await call("POST", "");
  expect(r.status).toBe(201);
  return ScreenCreatedSchema.parse(r.body);
}

describe("a browser screen", () => {
  it("is made without a token: an id, a code to type on the phone, and a secret only it keeps", async () => {
    const s = await newScreen();
    expect(s.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/);
    expect(s.secret.length).toBeGreaterThanOrEqual(32);
    const state = await call("GET", `/${s.screenId}`, { secret: s.secret });
    expect(state.status).toBe(200);
    expect(ScreenStateSchema.parse(state.body)).toEqual({ code: s.code, show: null });
  });

  it("keeps only a hash of its secret", async () => {
    const s = await newScreen();
    const row = await d1.db.prepare("SELECT * FROM screens WHERE id = ?").bind(s.screenId).first();
    expect(JSON.stringify(row)).not.toContain(s.secret);
  });

  it("answers only to its own secret", async () => {
    const s = await newScreen();
    expect((await call("GET", `/${s.screenId}`)).status).toBe(401);
    const wrong = await call("GET", `/${s.screenId}`, { secret: "x".repeat(43) });
    expect(wrong.status).toBe(403);
    expect(errorCode(wrong.body)).toBe("wrong_secret");
    expect((await call("GET", "/nope", { secret: s.secret })).status).toBe(404);
  });

  it("is claimed by a phone typing its code (any case, spaces, dashes)", async () => {
    const s = await newScreen();
    const typed = `${s.code.slice(0, 3).toLowerCase()}-${s.code.slice(3)}`;
    const r = await call("POST", "/claim", { auth: await phone("dana"), body: { code: typed } });
    expect(r.status).toBe(200);
    expect(ScreenClaimedSchema.parse(r.body)).toEqual({ screenId: s.screenId, name: "Browser TV" });
  });

  it("a code nobody shows can't be claimed", async () => {
    const r = await call("POST", "/claim", { auth: await phone("dana"), body: { code: "QQQQQQ" } });
    expect(r.status).toBe(404);
    expect(errorCode(r.body)).toBe("screen_not_found");
  });

  it("an unclaimed code runs out", async () => {
    const s = await newScreen();
    await d1.db
      .prepare("UPDATE screens SET created_at = ? WHERE id = ?")
      .bind(Date.now() - SCREEN_PAIR_TTL_MS - 1, s.screenId)
      .run();
    const r = await call("POST", "/claim", { auth: await phone("dana"), body: { code: s.code } });
    expect(r.status).toBe(404);
  });

  it("shows the launcher its owner casts: the screen reads the launcher token", async () => {
    const s = await newScreen();
    await call("POST", "/claim", { auth: await phone("dana"), body: { code: s.code } });
    const lt = await launcher("dana", "s1");
    const shown = await call("POST", `/${s.screenId}/show`, {
      auth: await phone("dana"),
      body: { token: lt },
    });
    expect(shown.status).toBe(204);
    const state = await call("GET", `/${s.screenId}`, { secret: s.secret });
    expect(ScreenStateSchema.parse(state.body)).toEqual({ code: s.code, show: { token: lt } });
  });

  it("won't show a launcher token for someone else's couch, or anything that isn't one", async () => {
    const s = await newScreen();
    await call("POST", "/claim", { auth: await phone("sam"), body: { code: s.code } });
    const others = await call("POST", `/${s.screenId}/show`, {
      auth: await phone("sam"),
      body: { token: await launcher("dana", "s1") },
    });
    expect(others.status).toBe(403);
    expect(errorCode(others.body)).toBe("not_your_couch");
    const notLauncher = await call("POST", `/${s.screenId}/show`, {
      auth: await phone("sam"),
      body: { token: await phone("sam") },
    });
    expect(notLauncher.status).toBe(400);
  });

  it("only its owner shows on it or stops it", async () => {
    const s = await newScreen();
    await call("POST", "/claim", { auth: await phone("dana"), body: { code: s.code } });
    const r = await call("POST", `/${s.screenId}/show`, {
      auth: await phone("sam"),
      body: { token: await launcher("dana", "s1") },
    });
    expect(r.status).toBe(403);
    expect(errorCode(r.body)).toBe("not_your_screen");
    expect((await call("POST", `/${s.screenId}/stop`, { auth: await phone("sam") })).status).toBe(
      403,
    );
  });

  it("stopping goes back to its code; a reclaim by the same phone shows again", async () => {
    const s = await newScreen();
    const dana = await phone("dana");
    await call("POST", "/claim", { auth: dana, body: { code: s.code } });
    await call("POST", `/${s.screenId}/show`, {
      auth: dana,
      body: { token: await launcher("dana", "s1") },
    });
    expect((await call("POST", `/${s.screenId}/stop`, { auth: dana })).status).toBe(204);
    const state = await call("GET", `/${s.screenId}`, { secret: s.secret });
    expect(ScreenStateSchema.parse(state.body)).toEqual({ code: s.code, show: null });
    // A claimed screen keeps its code while it lives: the phone can claim it again.
    const again = await call("POST", "/claim", { auth: dana, body: { code: s.code } });
    expect(again.status).toBe(200);
  });
});
