import type { Claims } from "@open-game-system/ogs-protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import app from "../src/index";
import { issueToken } from "../src/lib/identity";
import { openTestD1, type TestD1 } from "./support/d1";

/** The shell registers its native push token for its app (2026-10-18-white-label-apps.feature). */
const SECRET = "app-devices-secret";
let d1: TestD1;

beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  await d1.db.batch([
    d1.db.prepare("INSERT INTO profiles (id, handle, name, sticker) VALUES ('sam', 'sam', 'Sam', 'owl')"),
    d1.db.prepare("INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES ('sam-phone', 'sam', 'phone', 'Phone')"),
    d1.db.prepare("INSERT INTO native_apps (app_id, platform, store_id, team_id, created_at, updated_at) VALUES ('rocket-crew', 'ios', 'tv.rocketcrew.app', '34S957HD77', 1, 1)"),
  ]);
});

const tokenFor = (claims: Omit<Claims, "exp">) => issueToken(claims, SECRET, { now: Date.now(), ttlSeconds: 60 });
async function put(path: string, body: unknown, auth: string | null) {
  const res = await app.request(
    path,
    { method: "PUT", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) },
    { DB: d1.db, OGS_JWT_SECRET: SECRET },
  );
  const text = await res.text();
  return { status: res.status, body: text ? z.record(z.string(), z.unknown()).parse(JSON.parse(text)) : {} };
}
const APNS = { platform: "ios", token: "a".repeat(64), apnsEnvironment: "production" };
const errorCode = (body: Record<string, unknown>) => z.object({ error: z.object({ code: z.string() }) }).parse(body).error.code;

describe("PUT /api/v1/apps/:appId/devices/:deviceId", { timeout: 20_000 }, () => {
  it("stores the device's native token for the app (204), and updates it", async () => {
    const auth = await tokenFor({ sub: "sam", did: "sam-phone", kind: "phone" });
    expect((await put("/api/v1/apps/rocket-crew/devices/sam-phone", APNS, auth)).status).toBe(204);
    expect((await put("/api/v1/apps/rocket-crew/devices/sam-phone", { ...APNS, token: "b".repeat(64), apnsEnvironment: "sandbox" }, auth)).status).toBe(204);
    const row = await d1.db.prepare("SELECT * FROM app_devices").first();
    expect(row).toMatchObject({ device_id: "sam-phone", app_id: "rocket-crew", platform: "ios", token: "b".repeat(64), apns_environment: "sandbox" });
  });

  it("only the device's own token may register it (403 not_your_device)", async () => {
    const res = await put("/api/v1/apps/rocket-crew/devices/sam-phone", APNS, await tokenFor({ sub: "sam", did: "other-phone", kind: "phone" }));
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe("not_your_device");
    expect((await put("/api/v1/apps/rocket-crew/devices/sam-phone", APNS, null)).status).toBe(401);
  });

  it("the app must be registered for that platform (409 app_not_registered)", async () => {
    const auth = await tokenFor({ sub: "sam", did: "sam-phone", kind: "phone" });
    const res = await put("/api/v1/apps/rocket-crew/devices/sam-phone", { platform: "android", token: "fcm-token-123" }, auth);
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe("app_not_registered");
  });

  it("iOS needs the APNs environment; tokens are bounded (400)", async () => {
    const auth = await tokenFor({ sub: "sam", did: "sam-phone", kind: "phone" });
    expect((await put("/api/v1/apps/rocket-crew/devices/sam-phone", { platform: "ios", token: "a".repeat(64) }, auth)).status).toBe(400);
    expect((await put("/api/v1/apps/rocket-crew/devices/sam-phone", { ...APNS, token: "" }, auth)).status).toBe(400);
  });
});
