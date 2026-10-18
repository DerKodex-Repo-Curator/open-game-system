import {
  type Claims,
  ScreenClaimedSchema,
  ScreenCreatedSchema,
  ScreenStateSchema,
} from "@open-game-system/ogs-protocol";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import app from "../src/index";
import { issueToken } from "../src/lib/identity";
import {
  isLive,
  SCREEN_CLAIM_TTL_MS,
  SCREEN_PAIR_TTL_MS,
  type ScreenRow,
} from "../src/lib/screens";
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

// Every refusal in the error contract, word for word (what the TV page and the app show or log).
const refusal = (status: number, code: string, message: string) => ({
  status,
  body: { error: { code, message, status } },
});

describe("a browser screen's refusals", () => {
  it("names each one", async () => {
    const s = await newScreen();
    const dana = await phone("dana");
    expect(await call("GET", `/${s.screenId}`)).toEqual(
      refusal(401, "missing_secret", "X-Screen-Secret header is required"),
    );
    expect(await call("GET", `/${s.screenId}`, { secret: "x".repeat(43) })).toEqual(
      refusal(403, "wrong_secret", "That isn't this screen's secret"),
    );
    expect(await call("GET", "/nope", { secret: s.secret })).toEqual(
      refusal(404, "screen_not_found", "Screen not found"),
    );
    expect(await call("POST", "/claim", { auth: dana, body: {} })).toEqual(
      refusal(400, "invalid_body", "code (the 6 characters on the screen) is required"),
    );
    expect(await call("POST", "/claim", { auth: dana, body: { code: "QQQQQQ" } })).toEqual(
      refusal(404, "screen_not_found", "No screen shows that code"),
    );
    expect(await call("POST", `/${s.screenId}/show`, { auth: dana, body: { token: "t" } })).toEqual(
      refusal(403, "not_your_screen", "Claim this screen with its code first"),
    );
    expect(await call("POST", "/nope/show", { auth: dana, body: { token: "t" } })).toEqual(
      refusal(404, "screen_not_found", "Screen not found"),
    );
    await call("POST", "/claim", { auth: dana, body: { code: s.code } });
    expect(await call("POST", `/${s.screenId}/show`, { auth: dana, body: {} })).toEqual(
      refusal(400, "invalid_body", "token (the launcher token) is required"),
    );
    for (const shown of [
      "not-a-token",
      await phone("dana"),
      await token({ sub: "dana", did: "d-phone", kind: "phone", sid: "s1" }),
    ])
      expect(
        await call("POST", `/${s.screenId}/show`, { auth: dana, body: { token: shown } }),
      ).toEqual(refusal(400, "invalid_body", "token must be a launcher token"));
    expect(
      await call("POST", `/${s.screenId}/show`, {
        auth: dana,
        body: { token: await launcher("dana", "gone") },
      }),
    ).toEqual(refusal(403, "not_your_couch", "Only the couch's host shows it on a screen"));
  });
});

describe("how long a screen lives", () => {
  const now = 1_800_000_000_000;
  const row = (over: Partial<ScreenRow>): ScreenRow => ({
    id: "sc",
    code: "NT9WPH",
    secret_hash: "h",
    owner_profile_id: null,
    token: null,
    created_at: now,
    last_used_at: now,
    ...over,
  });

  it("unclaimed: an hour from when it was made", () => {
    expect(SCREEN_PAIR_TTL_MS).toBe(60 * 60 * 1000);
    expect(isLive(row({ created_at: now - SCREEN_PAIR_TTL_MS + 1 }), now)).toBe(true);
    expect(isLive(row({ created_at: now - SCREEN_PAIR_TTL_MS }), now)).toBe(false);
  });

  it("claimed: 30 days from its last cast", () => {
    expect(SCREEN_CLAIM_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    const claimed = { owner_profile_id: "dana", created_at: 0 };
    expect(isLive(row({ ...claimed, last_used_at: now - SCREEN_CLAIM_TTL_MS + 1 }), now)).toBe(
      true,
    );
    expect(isLive(row({ ...claimed, last_used_at: now - SCREEN_CLAIM_TTL_MS }), now)).toBe(false);
  });
});

/** Makes newCode() spell each given 6-letter code in turn (index into its alphabet = byte). */
function nextCodes(...codes: string[]) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const queue = [...codes];
  const real = crypto.getRandomValues.bind(crypto);
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    if (array instanceof Uint8Array && array.length === 6 && queue.length > 0) {
      const code = queue.length > 1 ? queue.shift() : queue[0];
      array.set([...(code ?? "")].map((ch) => alphabet.indexOf(ch)));
      return array;
    }
    return real(array);
  });
}

describe("a screen's code", () => {
  afterEach(() => vi.restoreAllMocks());
  const insertScreen = (
    id: string,
    code: string,
    owner: string | null,
    created: number,
    used: number,
  ) =>
    d1.db
      .prepare(
        "INSERT INTO screens (id, code, secret_hash, owner_profile_id, created_at, last_used_at) VALUES (?, ?, 'h', ?, ?, ?)",
      )
      .bind(id, code, owner, created, used)
      .run();

  it("draws again while a live screen holds the code", async () => {
    await insertScreen("live", "AAAAAA", null, Date.now(), Date.now());
    nextCodes("AAAAAA", "AAAAAA", "BBBBBB");
    expect((await newScreen()).code).toBe("BBBBBB");
  });

  it("gives up after five codes in use", async () => {
    await insertScreen("live", "AAAAAA", null, Date.now(), Date.now());
    nextCodes("AAAAAA", "AAAAAA", "AAAAAA", "AAAAAA", "AAAAAA", "BBBBBB");
    expect((await call("POST", "")).status).toBe(500);
  });

  it("takes a dead screen's code: unclaimed over an hour, or claimed and unused 30 days", async () => {
    const now = Date.now();
    await insertScreen("old", "AAAAAA", null, now - SCREEN_PAIR_TTL_MS - 1000, now);
    await insertScreen("idle", "BBBBBB", "dana", 0, now - SCREEN_CLAIM_TTL_MS - 1000);
    nextCodes("AAAAAA");
    expect((await newScreen()).code).toBe("AAAAAA");
    vi.restoreAllMocks();
    nextCodes("BBBBBB");
    expect((await newScreen()).code).toBe("BBBBBB");
  });

  it("never takes a live screen's code, claimed or not", async () => {
    const now = Date.now();
    await insertScreen("fresh", "AAAAAA", null, now - SCREEN_PAIR_TTL_MS + 60_000, now);
    await insertScreen("used", "BBBBBB", "dana", 0, now - SCREEN_CLAIM_TTL_MS + 60_000);
    nextCodes("AAAAAA", "BBBBBB", "CCCCCC");
    expect((await newScreen()).code).toBe("CCCCCC");
    const kept = await d1.db
      .prepare("SELECT id FROM screens WHERE code IN ('AAAAAA', 'BBBBBB') ORDER BY id")
      .all();
    expect(kept.results).toEqual([{ id: "fresh" }, { id: "used" }]);
  });
});
