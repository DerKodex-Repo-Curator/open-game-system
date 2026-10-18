import type { Claims } from "@open-game-system/ogs-protocol";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import app from "../src/index";
import { generateApiKey } from "../src/lib/api-keys";
import { issueToken } from "../src/lib/identity";
import { openTestD1, type TestD1 } from "./support/d1";

/**
 * Game pushes (docs/acceptance/2026-10-07-game-push.feature): opting in from the app, one send
 * endpoint with a per-game API key, routing to the last-active surface. Real local D1, fake Expo.
 */
const SECRET = "game-push-secret";
let d1: TestD1;
let cbKey: string;
let rcKey: string;
let expoCalls: { to: string; title: string; body: string; data?: Record<string, string> }[];
let expoAnswer: (to: string) => Record<string, unknown>;

beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  const cb = await generateApiKey();
  const rc = await generateApiKey();
  cbKey = cb.key;
  rcKey = rc.key;
  await d1.db.batch([
    ...["sam", "alex", "june"].map((id) =>
      d1.db
        .prepare("INSERT INTO profiles (id, handle, name, sticker) VALUES (?, ?, ?, 'owl')")
        .bind(id, id, id),
    ),
    d1.db.prepare(
      "INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES ('sam-phone', 'sam', 'phone', 'Phone')",
    ),
    d1.db.prepare(
      "INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES ('june-ipad', 'june', 'tablet', 'iPad')",
    ),
    d1.db.prepare(
      "INSERT INTO devices (ogs_device_id, platform, push_token) VALUES ('sam-phone', 'ios', 'ExponentPushToken[sam]')",
    ),
    d1.db.prepare(
      "INSERT INTO devices (ogs_device_id, platform, push_token) VALUES ('june-ipad', 'ios', 'ExponentPushToken[june]')",
    ),
    d1.db
      .prepare(
        "INSERT INTO game_api_keys (id, app_id, prefix, key_hash, scope, created_at) VALUES ('k-cb', 'codebreakers', ?, ?, 'notifications:send', 1)",
      )
      .bind(cb.prefix, cb.hash),
    d1.db
      .prepare(
        "INSERT INTO game_api_keys (id, app_id, prefix, key_hash, scope, created_at) VALUES ('k-rc', 'rocket-crew', ?, ?, 'notifications:send', 1)",
      )
      .bind(rc.prefix, rc.hash),
  ]);
  expoCalls = [];
  expoAnswer = () => ({ status: "ok", id: "ticket" });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (!String(url).startsWith("https://exp.host/")) throw new Error(`unexpected fetch ${url}`);
    const msg = JSON.parse(String(init.body));
    expoCalls.push(msg);
    return Response.json({ data: [expoAnswer(msg.to)] });
  });
});
afterEach(() => vi.unstubAllGlobals());

const env = () => ({ DB: d1.db, OGS_JWT_SECRET: SECRET });
const tokenFor = (claims: Omit<Claims, "exp">) =>
  issueToken(claims, SECRET, { now: Date.now(), ttlSeconds: 60 });
const phone = (sub: string) => tokenFor({ sub, did: `${sub}-phone`, kind: "phone" });
const tablet = (sub: string) => tokenFor({ sub, did: `${sub}-ipad`, kind: "tablet" });

async function call(method: string, path: string, auth: string | null, body?: unknown) {
  const res = await app.request(
    path,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env(),
  );
  return { status: res.status, body: z.record(z.string(), z.unknown()).parse(await res.json()) };
}

const optIn = async (sub: string, appId = "codebreakers", body: unknown = {}) =>
  call("POST", `/api/v1/games/${appId}/push-handles`, await phone(sub), body);
const handleOf = async (sub: string, appId = "codebreakers") =>
  z.string().parse((await optIn(sub, appId)).body.handle);
const send = (
  handles: string[],
  extra: Record<string, unknown> = {},
  key = cbKey,
  appId = "codebreakers",
) =>
  call("POST", `/api/v1/games/${appId}/notifications`, key, {
    to: handles,
    title: "Your clue, Keyholder",
    body: "Moon is up.",
    ...extra,
  });
const ErrorBody = z.object({ error: z.unknown() });
const statusOf = (res: { body: Record<string, unknown> }) =>
  z.object({ results: z.array(z.object({ to: z.string(), status: z.string() })) }).parse(res.body)
    .results;

describe("opting in from the app", () => {
  it("grants a handle that names no profile, device or token", async () => {
    const res = await optIn("sam");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("granted");
    const handle = z.string().parse(res.body.handle);
    expect(handle).toMatch(/^ph_[A-Za-z0-9_-]{16,64}$/);
    for (const secret of ["sam", "sam-phone", "ExponentPushToken"])
      expect(handle).not.toContain(secret);
  });

  it("gives the same player the same handle for the same game", async () => {
    expect(await handleOf("sam")).toBe(await handleOf("sam"));
  });

  it("gives a different handle for another game", async () => {
    expect(await handleOf("sam", "rocket-crew")).not.toBe(await handleOf("sam"));
  });

  it("joins the app surface to a handle the player already has", async () => {
    const pwaHandle = "ph_pwaonlyhandle0001";
    await d1.db
      .prepare("INSERT INTO push_handles (id, app_id, created_at) VALUES (?, 'codebreakers', 1)")
      .bind(pwaHandle)
      .run();
    const res = await optIn("sam", "codebreakers", { handle: pwaHandle });
    expect(res.body).toEqual({ status: "granted", handle: pwaHandle });
    const n = await d1.db
      .prepare("SELECT COUNT(*) AS n FROM push_surfaces WHERE handle_id = ? AND kind = 'ogs'")
      .bind(pwaHandle)
      .first("n");
    expect(n).toBe(1);
  });

  it("ignores a handle of another game and makes a new one", async () => {
    const rocket = await handleOf("sam", "rocket-crew");
    const res = await optIn("sam", "codebreakers", { handle: rocket });
    expect(res.body.handle).not.toBe(rocket);
  });

  it("never grants on a kid's iPad", async () => {
    const res = await call(
      "POST",
      "/api/v1/games/codebreakers/push-handles",
      await tablet("june"),
      {},
    );
    expect(res.body).toEqual({ status: "denied" });
    const n = await d1.db.prepare("SELECT COUNT(*) AS n FROM push_surfaces").first("n");
    expect(n).toBe(0);
  });

  it("needs a known game and a profile token", async () => {
    expect((await optIn("sam", "no-such-game")).status).toBe(404);
    expect((await call("POST", "/api/v1/games/codebreakers/push-handles", null, {})).status).toBe(
      401,
    );
    const launcher = await tokenFor({ sub: "sam", did: "tv", kind: "launcher", sid: "s1" });
    expect(
      (await call("POST", "/api/v1/games/codebreakers/push-handles", launcher, {})).status,
    ).toBe(403);
  });

  it("rejects a malformed body", async () => {
    expect((await optIn("sam", "codebreakers", { handle: "nope" })).status).toBe(400);
  });
});

describe("sending", () => {
  it("one call is delivered to the app", async () => {
    const h = await handleOf("sam");
    const res = await send([h], {
      url: "https://codebreakers.jonathanrmumm.workers.dev/room/KQTP",
      tag: "cb-KQTP",
    });
    expect(res.status).toBe(200);
    expect(statusOf(res)).toEqual([{ to: h, status: "sent" }]);
    expect(expoCalls).toHaveLength(1);
    expect(expoCalls[0]).toMatchObject({
      to: "ExponentPushToken[sam]",
      title: "Your clue, Keyholder",
      body: "Moon is up.",
      data: {
        type: "game-push",
        appId: "codebreakers",
        url: "https://codebreakers.jonathanrmumm.workers.dev/room/KQTP",
        tag: "cb-KQTP",
        whenOpen: "deliver",
      },
    });
  });

  it("defaults the url to the game's startUrl", async () => {
    const h = await handleOf("sam");
    await send([h], { whenOpen: "banner" });
    expect(expoCalls[0].data).toMatchObject({
      url: "https://codebreakers.jonathanrmumm.workers.dev/",
      whenOpen: "banner",
    });
  });

  it("refuses a url on another origin", async () => {
    const h = await handleOf("sam");
    const res = await send([h], { url: "https://elsewhere.example/x" });
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      code: "invalid_body",
      message: "url must be on the game's origin",
      status: 400,
    });
    expect(expoCalls).toHaveLength(0);
  });

  it("never pushes to a tablet even when the profile has one", async () => {
    await d1.db
      .prepare(
        "INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES ('sam-ipad', 'sam', 'tablet', 'iPad')",
      )
      .run();
    await d1.db
      .prepare(
        "INSERT INTO devices (ogs_device_id, platform, push_token) VALUES ('sam-ipad', 'ios', 'ExponentPushToken[sam-ipad]')",
      )
      .run();
    const h = await handleOf("sam");
    await send([h]);
    expect(expoCalls.map((c) => c.to)).toEqual(["ExponentPushToken[sam]"]);
  });

  it("consent turned off means not_permitted and nothing sent", async () => {
    const h = await handleOf("sam");
    const off = await call("DELETE", "/api/v1/me/push-grants/codebreakers", await phone("sam"));
    expect(off.status).toBe(200);
    expect(statusOf(await send([h]))).toEqual([{ to: h, status: "not_permitted" }]);
    expect(expoCalls).toHaveLength(0);
  });

  it("opting in again turns it back on", async () => {
    const h = await handleOf("sam");
    await call("DELETE", "/api/v1/me/push-grants/codebreakers", await phone("sam"));
    expect(await handleOf("sam")).toBe(h);
    expect(statusOf(await send([h]))).toEqual([{ to: h, status: "sent" }]);
  });

  it("a handle of another game, or an unknown one, is not_permitted", async () => {
    const rocket = await handleOf("sam", "rocket-crew");
    const res = await send([rocket, "ph_doesnotexist000000"]);
    expect(statusOf(res)).toEqual([
      { to: rocket, status: "not_permitted" },
      { to: "ph_doesnotexist000000", status: "not_permitted" },
    ]);
  });

  it("a device Expo says is gone is forgotten; no device left is gone", async () => {
    const h = await handleOf("sam");
    expoAnswer = () => ({
      status: "error",
      message: "gone",
      details: { error: "DeviceNotRegistered" },
    });
    expect(statusOf(await send([h]))).toEqual([{ to: h, status: "gone" }]);
    const n = await d1.db
      .prepare("SELECT COUNT(*) AS n FROM devices WHERE ogs_device_id = 'sam-phone'")
      .first("n");
    expect(n).toBe(0);
  });

  it("a transient Expo error is failed, and the device is kept", async () => {
    const h = await handleOf("sam");
    expoAnswer = () => ({
      status: "error",
      message: "MessageRateExceeded",
      details: { error: "MessageRateExceeded" },
    });
    expect(statusOf(await send([h]))).toEqual([{ to: h, status: "failed" }]);
    const n = await d1.db
      .prepare("SELECT COUNT(*) AS n FROM devices WHERE ogs_device_id = 'sam-phone'")
      .first("n");
    expect(n).toBe(1);
  });

  it("a profile with no phone registered is gone", async () => {
    const h = await handleOf("alex");
    expect(statusOf(await send([h]))).toEqual([{ to: h, status: "gone" }]);
  });

  it("answers per handle, in order, for several handles", async () => {
    const s = await handleOf("sam");
    const a = await handleOf("alex");
    expect(statusOf(await send([s, a]))).toEqual([
      { to: s, status: "sent" },
      { to: a, status: "gone" },
    ]);
  });
});

describe("the game's API key", () => {
  it("needs a key", async () => {
    const res = await call("POST", "/api/v1/games/codebreakers/notifications", null, {
      to: [],
      title: "t",
      body: "b",
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      code: "missing_auth",
      message: "Authorization header is required",
      status: 401,
    });
  });

  it("needs the Bearer scheme, at the start, with the key after it", async () => {
    const invalidAuth = {
      code: "invalid_auth",
      message: "Authorization header must use Bearer scheme",
      status: 401,
    };
    for (const header of [`Basic ${cbKey}`, `xBearer ${cbKey}`, "Bearer ", "Bearer"]) {
      const res = await app.request(
        "/api/v1/games/codebreakers/notifications",
        { method: "POST", headers: { Authorization: header }, body: "{}" },
        env(),
      );
      expect(res.status, header).toBe(401);
      expect(ErrorBody.parse(await res.json()).error, header).toEqual(invalidAuth);
    }
  });

  it("accepts any whitespace after Bearer, and is case-insensitive", async () => {
    for (const header of [`bearer ${cbKey}`, `Bearer   ${cbKey}`]) {
      const res = await app.request(
        "/api/v1/games/codebreakers/notifications",
        {
          method: "POST",
          headers: { Authorization: header, "Content-Type": "application/json" },
          body: JSON.stringify({ to: ["ph_doesnotexist000000"], title: "t", body: "b" }),
        },
        env(),
      );
      expect(res.status, header).toBe(200);
    }
  });

  it("a key with trailing text is a different key", async () => {
    const res = await send(["ph_doesnotexist000000"], {}, `${cbKey} extra`);
    expect(res.status).toBe(401);
  });

  it("rejects an unknown key", async () => {
    const res = await send(["ph_doesnotexist000000"], {}, "ogsk_notarealkey");
    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      code: "invalid_api_key",
      message: "The provided API key is invalid",
      status: 401,
    });
  });

  it("rejects another game's key", async () => {
    const res = await send(["ph_doesnotexist000000"], {}, rcKey);
    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({
      code: "wrong_game",
      message: "This API key belongs to another game",
      status: 403,
    });
  });

  it("rejects a revoked key", async () => {
    await d1.db.prepare("UPDATE game_api_keys SET revoked_at = 2 WHERE id = 'k-cb'").run();
    expect((await send(["ph_doesnotexist000000"])).status).toBe(401);
  });

  it("answers 404 for a game outside the catalogue, even with a key for it", async () => {
    const ghost = await generateApiKey();
    await d1.db
      .prepare(
        "INSERT INTO game_api_keys (id, app_id, prefix, key_hash, scope, created_at) VALUES ('k-g', 'ghost', ?, ?, 'notifications:send', 1)",
      )
      .bind(ghost.prefix, ghost.hash)
      .run();
    const res = await send(["ph_doesnotexist000000"], {}, ghost.key, "ghost");
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({
      code: "unknown_game",
      message: "No game with that appId",
      status: 404,
    });
  });

  it("rejects a malformed body with missing_fields", async () => {
    const res = await call("POST", "/api/v1/games/codebreakers/notifications", cbKey, {
      to: ["ph_doesnotexist000000"],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      code: "missing_fields",
      message: "to (1-100 push handles), title (≤ 60) and body (≤ 180) are required",
      status: 400,
    });
  });

  it("rejects a body that isn't JSON with invalid_body", async () => {
    const res = await app.request(
      "/api/v1/games/codebreakers/notifications",
      { method: "POST", headers: { Authorization: `Bearer ${cbKey}` }, body: "not json" },
      env(),
    );
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).error).toEqual({
      code: "invalid_body",
      message: "Request body must be valid JSON",
      status: 400,
    });
  });
});

describe("the app's notification settings", () => {
  it("lists the games a profile allowed, and drops one when turned off", async () => {
    await handleOf("sam");
    await handleOf("sam", "rocket-crew");
    const list = await call("GET", "/api/v1/me/push-grants", await phone("sam"));
    expect(list.body).toEqual({ games: ["codebreakers", "rocket-crew"] });
    await call("DELETE", "/api/v1/me/push-grants/rocket-crew", await phone("sam"));
    expect((await call("GET", "/api/v1/me/push-grants", await phone("sam"))).body).toEqual({
      games: ["codebreakers"],
    });
  });

  it("marks the app surface active when the game opens, so it wins over an older surface", async () => {
    const h = await handleOf("sam");
    const other = await handleOf("sam", "rocket-crew");
    await d1.db.prepare("UPDATE push_surfaces SET last_active_at = 1").run();
    const res = await call("POST", "/api/v1/me/push-active/codebreakers", await phone("sam"));
    expect(res.status).toBe(200);
    const at = await d1.db
      .prepare("SELECT last_active_at AS t FROM push_surfaces WHERE handle_id = ?")
      .bind(h)
      .first("t");
    expect(Number(at)).toBeGreaterThan(Date.now() - 5000);
    const untouched = await d1.db
      .prepare("SELECT last_active_at AS t FROM push_surfaces WHERE handle_id = ?")
      .bind(other)
      .first("t");
    expect(untouched).toBe(1);
  });
});

describe("the old device-token endpoint", () => {
  it("is gone", async () => {
    const res = await app.request(
      "/api/v1/notifications/send",
      { method: "POST", headers: { Authorization: `Bearer ${cbKey}` }, body: "{}" },
      env(),
    );
    expect(res.status).toBe(404);
  });

  it("device registration returns no device token", async () => {
    const res = await call("POST", "/api/v1/devices/register", null, {
      ogsDeviceId: "d9",
      platform: "ios",
      pushToken: "ExponentPushToken[d9]",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deviceId: "d9", registered: true });
  });
});
