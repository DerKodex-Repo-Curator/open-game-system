import type { Claims } from "@open-game-system/ogs-protocol";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import app from "../src/index";
import { issueToken } from "../src/lib/identity";
import { openTestD1, type TestD1 } from "./support/d1";

/** PUT /api/v1/apps/:appId/devices/:deviceId in detail (2026-10-18-white-label-apps.feature). */
const SECRET = "app-devices-edges-secret";
let d1: TestD1;

beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  await d1.db.batch([
    d1.db.prepare(
      "INSERT INTO profiles (id, handle, name, sticker) VALUES ('sam', 'sam', 'Sam', 'owl')",
    ),
    d1.db.prepare(
      "INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES ('sam-phone', 'sam', 'phone', 'Phone')",
    ),
    d1.db.prepare(
      "INSERT INTO native_apps (app_id, platform, store_id, team_id, created_at, updated_at) VALUES ('rocket-crew', 'ios', 'tv.rocketcrew.app', '34S957HD77', 1, 1)",
    ),
    d1.db.prepare(
      "INSERT INTO native_apps (app_id, platform, store_id, sha256_fingerprints, google_client_ids, created_at, updated_at) VALUES ('rocket-crew', 'android', 'tv.rocketcrew.app', '[]', '[]', 1, 1)",
    ),
  ]);
});
afterEach(() => vi.useRealTimers());

const tokenFor = (claims: Omit<Claims, "exp">) =>
  issueToken(claims, SECRET, { now: Date.now(), ttlSeconds: 60 });
const samPhone = () => tokenFor({ sub: "sam", did: "sam-phone", kind: "phone" });
async function put(path: string, body: unknown, auth: string | null) {
  const res = await app.request(
    path,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    { DB: d1.db, OGS_JWT_SECRET: SECRET },
  );
  const text = await res.text();
  return {
    status: res.status,
    body: text ? z.record(z.string(), z.unknown()).parse(JSON.parse(text)) : {},
  };
}
const errorOf = (body: Record<string, unknown>) =>
  z.object({ error: z.object({ code: z.string(), message: z.string() }) }).parse(body).error;
const PATH = "/api/v1/apps/rocket-crew/devices/sam-phone";
const APNS = { platform: "ios", token: "a".repeat(64), apnsEnvironment: "production" };
const rows = () =>
  d1.db
    .prepare(
      "SELECT device_id, app_id, platform, token, apns_environment, updated_at FROM app_devices",
    )
    .all();

describe("PUT /api/v1/apps/:appId/devices/:deviceId: the edges", { timeout: 20_000 }, () => {
  it("stores an Android token with no APNs environment, at the time it was sent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(7_000);
    expect(
      (await put(PATH, { platform: "android", token: "fcm-token-1" }, await samPhone())).status,
    ).toBe(204);
    expect((await rows()).results).toEqual([
      {
        device_id: "sam-phone",
        app_id: "rocket-crew",
        platform: "android",
        token: "fcm-token-1",
        apns_environment: null,
        updated_at: 7_000,
      },
    ]);
  });

  it("a device that moves from iOS to Android is one row, Android now", async () => {
    const auth = await samPhone();
    await put(PATH, APNS, auth);
    await put(PATH, { platform: "android", token: "fcm-token-1" }, auth);
    expect((await rows()).results).toMatchObject([
      { platform: "android", token: "fcm-token-1", apns_environment: null },
    ]);
  });

  it("each app keeps its own row for the device", async () => {
    await d1.db
      .prepare(
        "INSERT INTO native_apps (app_id, platform, store_id, team_id, created_at, updated_at) VALUES ('codebreakers', 'ios', 'org.codebreakers', '34S957HD77', 1, 1)",
      )
      .run();
    const auth = await samPhone();
    await put(PATH, APNS, auth);
    await put(
      "/api/v1/apps/codebreakers/devices/sam-phone",
      { ...APNS, token: "b".repeat(64) },
      auth,
    );
    expect(
      (await rows()).results.map((r) => z.object({ app_id: z.string() }).parse(r).app_id).sort(),
    ).toEqual(["codebreakers", "rocket-crew"]);
  });

  it("not your device says how to register one", async () => {
    const res = await put(
      PATH,
      APNS,
      await tokenFor({ sub: "sam", did: "other-phone", kind: "phone" }),
    );
    expect(errorOf(res.body)).toEqual({
      code: "not_your_device",
      message: "Register a device with its own token",
    });
    expect((await rows()).results).toEqual([]);
  });

  it("a TV launcher's token can't register a device (403 profile_token_required)", async () => {
    const res = await put(
      PATH,
      APNS,
      await tokenFor({ sub: "sam", did: "sam-phone", kind: "launcher", sid: "s1" }),
    );
    expect(res.status).toBe(403);
    expect(errorOf(res.body).code).toBe("profile_token_required");
  });

  it("an unregistered app names the platform and the game", async () => {
    const res = await put(
      "/api/v1/apps/codebreakers/devices/sam-phone",
      { platform: "android", token: "fcm-token-1" },
      await samPhone(),
    );
    expect(errorOf(res.body)).toEqual({
      code: "app_not_registered",
      message: "No android app is registered for codebreakers",
    });
  });

  it("a bad body says what's required", async () => {
    const res = await put(PATH, { platform: "windows", token: "x" }, await samPhone());
    expect(errorOf(res.body)).toEqual({
      code: "invalid_body",
      message: "platform, token (and apnsEnvironment on iOS) are required",
    });
    expect((await put(PATH, "{", await samPhone())).status).toBe(400);
  });

  it.each([
    ["31 hex characters", { ...APNS, token: "a".repeat(31) }],
    ["201 hex characters", { ...APNS, token: "a".repeat(201) }],
    ["a character that isn't hex", { ...APNS, token: `${"a".repeat(63)}g` }],
    ["a prefix", { ...APNS, token: `x${"a".repeat(64)}` }],
    ["a suffix", { ...APNS, token: `${"a".repeat(64)}x` }],
    ["an unknown APNs environment", { ...APNS, apnsEnvironment: "staging" }],
    ["an empty Android token", { platform: "android", token: "" }],
    ["an Android token over 4096", { platform: "android", token: "t".repeat(4097) }],
  ])("refuses %s", async (_what, body) => {
    expect((await put(PATH, body, await samPhone())).status).toBe(400);
  });

  it.each([
    ["32 hex characters", { ...APNS, token: "a".repeat(32) }],
    ["200 upper and lower case hex characters", { ...APNS, token: "aF09".repeat(50) }],
    ["the sandbox", { ...APNS, apnsEnvironment: "sandbox" }],
    ["a 4096 Android token", { platform: "android", token: "t".repeat(4096) }],
  ])("accepts %s", async (_what, body) => {
    expect((await put(PATH, body, await samPhone())).status).toBe(204);
  });
});
