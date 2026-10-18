import type { Claims } from "@open-game-system/ogs-protocol";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import app from "../src/index";
import { issueToken, readClaims } from "../src/lib/identity";
import { openTestD1, type TestD1 } from "./support/d1";
import { type FakeIssuer, fakeIssuer } from "./support/issuer";

/**
 * White-label sign-in (docs/acceptance/2026-10-18-white-label-native-sign-in.feature): a guest in a
 * game's own app backs up with Apple or Google; the audience is a registered app's.
 */
const SECRET = "native-auth-secret";
const APPLE = "https://apple.test";
const GOOGLE = "https://accounts.google.com";
const RC_GOOGLE = "123-abc.apps.googleusercontent.com";
let d1: TestD1;
let apple: FakeIssuer;
let google: FakeIssuer;

beforeAll(async () => {
  d1 = await openTestD1();
  apple = await fakeIssuer(APPLE);
  google = await fakeIssuer(GOOGLE);
});
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  await d1.db.batch([
    ...["ada", "guest1", "guest2"].map((id) =>
      d1.db.prepare("INSERT INTO profiles (id, handle, name, sticker) VALUES (?, ?, ?, 'owl')").bind(id, id, id),
    ),
    d1.db.prepare("INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES ('guest1-phone', 'guest1', 'phone', 'Phone')"),
    d1.db.prepare("INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES ('guest2-phone', 'guest2', 'phone', 'Phone')"),
    d1.db.prepare(
      "INSERT INTO native_apps (app_id, platform, store_id, team_id, created_at, updated_at) VALUES ('rocket-crew', 'ios', 'tv.rocketcrew.app', '34S957HD77', 1, 1)",
    ),
    d1.db
      .prepare(
        "INSERT INTO native_apps (app_id, platform, store_id, sha256_fingerprints, google_client_ids, created_at, updated_at) VALUES ('rocket-crew', 'android', 'tv.rocketcrew.app', '[]', ?, 1, 1)",
      )
      .bind(JSON.stringify([RC_GOOGLE])),
  ]);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => apple.handles(String(input)) ?? google.handles(String(input)) ?? new Response("not found", { status: 404 }));
});
afterEach(() => vi.unstubAllGlobals());

const env = () => ({ DB: d1.db, OGS_JWT_SECRET: SECRET, APPLE_ISSUER: APPLE, APPLE_CLIENT_IDS: "org.opengame.app", GOOGLE_CLIENT_IDS: "ogs-google-client" });
const tokenFor = (claims: Omit<Claims, "exp">) => issueToken(claims, SECRET, { now: Date.now(), ttlSeconds: 60 });
const guestToken = (id: string) => tokenFor({ sub: id, did: `${id}-phone`, kind: "phone" });
const appleToken = (sub: string, aud = "tv.rocketcrew.app") => apple.idToken({ sub, aud, email: `${sub}@icloud.com`, email_verified: "true" });

async function post(path: string, body: unknown, auth?: string) {
  const res = await app.request(
    path,
    { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) },
    env(),
  );
  return { status: res.status, body: z.record(z.string(), z.unknown()).parse(await res.json()) };
}
const loginOwner = async (provider: string, subject: string) =>
  (await d1.db.prepare("SELECT profile_id FROM profile_logins WHERE provider = ? AND subject = ?").bind(provider, subject).first<{ profile_id: string }>())?.profile_id;
const profileId = (body: Record<string, unknown>) => z.object({ profile: z.object({ id: z.string() }) }).parse(body).profile.id;
const errorCode = (body: Record<string, unknown>) => z.object({ error: z.object({ code: z.string() }) }).parse(body).error.code;

describe("POST /api/v1/auth/native", { timeout: 20_000 }, () => {
  it("a guest backs up with Sign in with Apple for a registered app: same profile, a device token", async () => {
    const res = await post("/api/v1/auth/native", { provider: "apple", identityToken: await appleToken("apple-ada"), deviceProfileId: "guest1" }, await guestToken("guest1"));
    expect(res.status).toBe(200);
    expect(profileId(res.body)).toBe("guest1");
    expect(await loginOwner("apple", "apple-ada")).toBe("guest1");
    const claims = await readClaims(z.string().parse(res.body.token), SECRET, Date.now());
    expect(claims).toMatchObject({ sub: "guest1", did: "guest1-phone", kind: "phone" });
  });

  it("a guest signs in to an account that already exists: the device moves to it", async () => {
    await d1.db.prepare("INSERT INTO profile_logins (provider, subject, profile_id, email) VALUES ('apple', 'apple-ada', 'ada', NULL)").run();
    const res = await post("/api/v1/auth/native", { provider: "apple", identityToken: await appleToken("apple-ada"), deviceProfileId: "guest2" }, await guestToken("guest2"));
    expect(res.status).toBe(200);
    expect(profileId(res.body)).toBe("ada");
    expect((await d1.db.prepare("SELECT profile_id FROM profile_devices WHERE device_id = 'guest2-phone'").first<{ profile_id: string }>())?.profile_id).toBe("ada");
    const claims = await readClaims(z.string().parse(res.body.token), SECRET, Date.now());
    expect(claims).toMatchObject({ sub: "ada", did: "guest2-phone" });
  });

  it("Google on Android: the audience is the app's registered Google client id", async () => {
    const identityToken = await google.idToken({ sub: "g-ada", aud: RC_GOOGLE, email: "ada@gmail.com", email_verified: true });
    const res = await post("/api/v1/auth/native", { provider: "google", identityToken, deviceProfileId: "guest1" }, await guestToken("guest1"));
    expect(res.status).toBe(200);
    expect(await loginOwner("google", "g-ada")).toBe("guest1");
  });

  it("refuses tokens for apps that aren't registered (401 invalid_id_token)", async () => {
    const res = await post("/api/v1/auth/native", { provider: "apple", identityToken: await appleToken("apple-x", "com.example.unknown"), deviceProfileId: "guest1" }, await guestToken("guest1"));
    expect(res.status).toBe(401);
    expect(errorCode(res.body)).toBe("invalid_id_token");
  });

  it("the guest must be proven by its own token (403 not_your_profile)", async () => {
    const without = await post("/api/v1/auth/native", { provider: "apple", identityToken: await appleToken("apple-ada"), deviceProfileId: "guest1" });
    expect(without.status).toBe(403);
    expect(errorCode(without.body)).toBe("not_your_profile");
    const other = await post("/api/v1/auth/native", { provider: "apple", identityToken: await appleToken("apple-ada"), deviceProfileId: "guest1" }, await guestToken("guest2"));
    expect(errorCode(other.body)).toBe("not_your_profile");
    expect(await loginOwner("apple", "apple-ada")).toBeUndefined();
  });

  it("without a guest it signs a known login in on a new device", async () => {
    await d1.db.prepare("INSERT INTO profile_logins (provider, subject, profile_id, email) VALUES ('apple', 'apple-ada', 'ada', NULL)").run();
    const res = await post("/api/v1/auth/native", { provider: "apple", identityToken: await appleToken("apple-ada"), device: { deviceId: "ada-new-phone", kind: "phone", name: "Phone" } });
    expect(res.status).toBe(200);
    expect(profileId(res.body)).toBe("ada");
  });

  it("refuses a bad body (400)", async () => {
    expect((await post("/api/v1/auth/native", { provider: "facebook", identityToken: "x" })).status).toBe(400);
  });

  it("the OGS app's own Apple sign-in is unchanged (audience org.opengame.app)", async () => {
    await d1.db.prepare("INSERT INTO profile_logins (provider, subject, profile_id, email) VALUES ('apple', 'apple-ada', 'ada', NULL)").run();
    const res = await post("/api/v1/auth/apple", { idToken: await appleToken("apple-ada", "org.opengame.app"), device: { deviceId: "ada-phone", kind: "phone", name: "Phone" } });
    expect(res.status).toBe(200);
    expect(profileId(res.body)).toBe("ada");
  });
});
