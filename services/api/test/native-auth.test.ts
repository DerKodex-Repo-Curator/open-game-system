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
      d1.db
        .prepare("INSERT INTO profiles (id, handle, name, sticker) VALUES (?, ?, ?, 'owl')")
        .bind(id, id, id),
    ),
    d1.db.prepare(
      "INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES ('guest1-phone', 'guest1', 'phone', 'Phone')",
    ),
    d1.db.prepare(
      "INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES ('guest2-phone', 'guest2', 'phone', 'Phone')",
    ),
    d1.db.prepare(
      "INSERT INTO native_apps (app_id, platform, store_id, team_id, created_at, updated_at) VALUES ('rocket-crew', 'ios', 'tv.rocketcrew.app', '34S957HD77', 1, 1)",
    ),
    d1.db
      .prepare(
        "INSERT INTO native_apps (app_id, platform, store_id, sha256_fingerprints, google_client_ids, created_at, updated_at) VALUES ('rocket-crew', 'android', 'tv.rocketcrew.app', '[]', ?, 1, 1)",
      )
      .bind(JSON.stringify([RC_GOOGLE])),
  ]);
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL) =>
      apple.handles(String(input)) ??
      google.handles(String(input)) ??
      new Response("not found", { status: 404 }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const env = () => ({
  DB: d1.db,
  OGS_JWT_SECRET: SECRET,
  APPLE_ISSUER: APPLE,
  APPLE_CLIENT_IDS: "org.opengame.app",
  GOOGLE_CLIENT_IDS: "ogs-google-client",
});
const tokenFor = (claims: Omit<Claims, "exp">) =>
  issueToken(claims, SECRET, { now: Date.now(), ttlSeconds: 60 });
const guestToken = (id: string) => tokenFor({ sub: id, did: `${id}-phone`, kind: "phone" });
const appleToken = (sub: string, aud = "tv.rocketcrew.app") =>
  apple.idToken({ sub, aud, email: `${sub}@icloud.com`, email_verified: "true" });

async function post(path: string, body: unknown, auth?: string) {
  const res = await app.request(
    path,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify(body),
    },
    env(),
  );
  return { status: res.status, body: z.record(z.string(), z.unknown()).parse(await res.json()) };
}
const loginOwner = async (provider: string, subject: string) =>
  (
    await d1.db
      .prepare("SELECT profile_id FROM profile_logins WHERE provider = ? AND subject = ?")
      .bind(provider, subject)
      .first<{ profile_id: string }>()
  )?.profile_id;
const profileId = (body: Record<string, unknown>) =>
  z.object({ profile: z.object({ id: z.string() }) }).parse(body).profile.id;
const errorCode = (body: Record<string, unknown>) =>
  z.object({ error: z.object({ code: z.string() }) }).parse(body).error.code;

describe("POST /api/v1/auth/native", { timeout: 20_000 }, () => {
  it("a guest backs up with Sign in with Apple for a registered app: same profile, a device token", async () => {
    const res = await post(
      "/api/v1/auth/native",
      {
        provider: "apple",
        identityToken: await appleToken("apple-ada"),
        deviceProfileId: "guest1",
      },
      await guestToken("guest1"),
    );
    expect(res.status).toBe(200);
    expect(profileId(res.body)).toBe("guest1");
    expect(await loginOwner("apple", "apple-ada")).toBe("guest1");
    const claims = await readClaims(z.string().parse(res.body.token), SECRET, Date.now());
    expect(claims).toMatchObject({ sub: "guest1", did: "guest1-phone", kind: "phone" });
  });

  it("a guest signs in to an account that already exists: the device moves to it", async () => {
    await d1.db
      .prepare(
        "INSERT INTO profile_logins (provider, subject, profile_id, email) VALUES ('apple', 'apple-ada', 'ada', NULL)",
      )
      .run();
    const res = await post(
      "/api/v1/auth/native",
      {
        provider: "apple",
        identityToken: await appleToken("apple-ada"),
        deviceProfileId: "guest2",
      },
      await guestToken("guest2"),
    );
    expect(res.status).toBe(200);
    expect(profileId(res.body)).toBe("ada");
    expect(
      (
        await d1.db
          .prepare("SELECT profile_id FROM profile_devices WHERE device_id = 'guest2-phone'")
          .first<{ profile_id: string }>()
      )?.profile_id,
    ).toBe("ada");
    const claims = await readClaims(z.string().parse(res.body.token), SECRET, Date.now());
    expect(claims).toMatchObject({ sub: "ada", did: "guest2-phone" });
  });

  it("Google on Android: the audience is the app's registered Google client id", async () => {
    const identityToken = await google.idToken({
      sub: "g-ada",
      aud: RC_GOOGLE,
      email: "ada@gmail.com",
      email_verified: true,
    });
    const res = await post(
      "/api/v1/auth/native",
      { provider: "google", identityToken, deviceProfileId: "guest1" },
      await guestToken("guest1"),
    );
    expect(res.status).toBe(200);
    expect(await loginOwner("google", "g-ada")).toBe("guest1");
  });

  it("refuses tokens for apps that aren't registered (401 invalid_id_token)", async () => {
    const res = await post(
      "/api/v1/auth/native",
      {
        provider: "apple",
        identityToken: await appleToken("apple-x", "com.example.unknown"),
        deviceProfileId: "guest1",
      },
      await guestToken("guest1"),
    );
    expect(res.status).toBe(401);
    expect(errorCode(res.body)).toBe("invalid_id_token");
  });

  it("the guest must be proven by its own token (403 not_your_profile)", async () => {
    const without = await post("/api/v1/auth/native", {
      provider: "apple",
      identityToken: await appleToken("apple-ada"),
      deviceProfileId: "guest1",
    });
    expect(without.status).toBe(403);
    expect(errorCode(without.body)).toBe("not_your_profile");
    const other = await post(
      "/api/v1/auth/native",
      {
        provider: "apple",
        identityToken: await appleToken("apple-ada"),
        deviceProfileId: "guest1",
      },
      await guestToken("guest2"),
    );
    expect(errorCode(other.body)).toBe("not_your_profile");
    expect(await loginOwner("apple", "apple-ada")).toBeUndefined();
  });

  it("without a guest it signs a known login in on a new device", async () => {
    await d1.db
      .prepare(
        "INSERT INTO profile_logins (provider, subject, profile_id, email) VALUES ('apple', 'apple-ada', 'ada', NULL)",
      )
      .run();
    const res = await post("/api/v1/auth/native", {
      provider: "apple",
      identityToken: await appleToken("apple-ada"),
      device: { deviceId: "ada-new-phone", kind: "phone", name: "Phone" },
    });
    expect(res.status).toBe(200);
    expect(profileId(res.body)).toBe("ada");
  });

  it("refuses a bad body (400)", async () => {
    expect(
      (await post("/api/v1/auth/native", { provider: "facebook", identityToken: "x" })).status,
    ).toBe(400);
  });

  it("the OGS app's own Apple sign-in is unchanged (audience org.opengame.app)", async () => {
    await d1.db
      .prepare(
        "INSERT INTO profile_logins (provider, subject, profile_id, email) VALUES ('apple', 'apple-ada', 'ada', NULL)",
      )
      .run();
    const res = await post("/api/v1/auth/apple", {
      idToken: await appleToken("apple-ada", "org.opengame.app"),
      device: { deviceId: "ada-phone", kind: "phone", name: "Phone" },
    });
    expect(res.status).toBe(200);
    expect(profileId(res.body)).toBe("ada");
  });
});

const errorOf = (body: Record<string, unknown>) =>
  z.object({ error: z.object({ code: z.string(), message: z.string() }) }).parse(body).error;
const deviceRow = (deviceId: string) =>
  d1.db
    .prepare("SELECT profile_id, kind, name FROM profile_devices WHERE device_id = ?")
    .bind(deviceId)
    .first();

describe("POST /api/v1/auth/native: the edges", { timeout: 20_000 }, () => {
  it("a bad body is 400 invalid_body with what's required, and so is a body that isn't JSON", async () => {
    const res = await post("/api/v1/auth/native", { provider: "apple" });
    expect(errorOf(res.body)).toEqual({
      code: "invalid_body",
      message: "provider (apple | google) and identityToken are required",
    });
    const raw = await app.request(
      "/api/v1/auth/native",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" },
      env(),
    );
    expect(raw.status).toBe(400);
  });

  it("neither a guest nor a device is 400 with what's required", async () => {
    const res = await post("/api/v1/auth/native", {
      provider: "apple",
      identityToken: await appleToken("apple-ada"),
    });
    expect(res.status).toBe(400);
    expect(errorOf(res.body)).toEqual({
      code: "invalid_body",
      message: "deviceProfileId (with its token) or device is required",
    });
  });

  it("a guest proven by a launcher token, or a token that isn't one, is 403 with how to prove it", async () => {
    const launcher = await tokenFor({
      sub: "guest1",
      did: "guest1-tv",
      kind: "launcher",
      sid: "s1",
    });
    const res = await post(
      "/api/v1/auth/native",
      {
        provider: "apple",
        identityToken: await appleToken("apple-ada"),
        deviceProfileId: "guest1",
      },
      launcher,
    );
    expect(res.status).toBe(403);
    expect(errorOf(res.body)).toEqual({
      code: "not_your_profile",
      message: "Send the guest profile's own device token with deviceProfileId",
    });
    const garbage = await post(
      "/api/v1/auth/native",
      {
        provider: "apple",
        identityToken: await appleToken("apple-ada"),
        deviceProfileId: "guest1",
      },
      "not-a-token",
    );
    expect(garbage.status).toBe(403);
    expect(await loginOwner("apple", "apple-ada")).toBeUndefined();
  });

  it("an invalid token says which provider and that the app must be registered", async () => {
    const res = await post(
      "/api/v1/auth/native",
      { provider: "google", identityToken: "x.y.z", deviceProfileId: "guest1" },
      await guestToken("guest1"),
    );
    expect(res.status).toBe(401);
    expect(errorOf(res.body)).toEqual({
      code: "invalid_id_token",
      message: "Not a valid google identity token for a registered app",
    });
  });

  it("the nonce is checked when sent: a different one is 401, the same one signs in", async () => {
    const identityToken = await apple.idToken({
      sub: "apple-ada",
      aud: "tv.rocketcrew.app",
      nonce: "n-1",
    });
    const wrong = await post(
      "/api/v1/auth/native",
      { provider: "apple", identityToken, nonce: "n-2", deviceProfileId: "guest1" },
      await guestToken("guest1"),
    );
    expect(wrong.status).toBe(401);
    const right = await post(
      "/api/v1/auth/native",
      { provider: "apple", identityToken, nonce: "n-1", deviceProfileId: "guest1" },
      await guestToken("guest1"),
    );
    expect(right.status).toBe(200);
  });

  it("the OGS app's own audiences are accepted too (APPLE_CLIENT_IDS / GOOGLE_CLIENT_IDS)", async () => {
    const viaApple = await post(
      "/api/v1/auth/native",
      {
        provider: "apple",
        identityToken: await appleToken("apple-ada", "org.opengame.app"),
        deviceProfileId: "guest1",
      },
      await guestToken("guest1"),
    );
    expect(viaApple.status).toBe(200);
    const identityToken = await google.idToken({
      sub: "g-grace",
      aud: "ogs-google-client",
      email: "grace@gmail.com",
      email_verified: true,
    });
    const viaGoogle = await post(
      "/api/v1/auth/native",
      { provider: "google", identityToken, deviceProfileId: "guest2" },
      await guestToken("guest2"),
    );
    expect(viaGoogle.status).toBe(200);
    expect(await loginOwner("google", "g-grace")).toBe("guest2");
  });

  it("an Apple token is not checked against Google client ids (and the other way round)", async () => {
    const asGoogle = await apple.idToken({ sub: "apple-ada", aud: RC_GOOGLE });
    expect(
      (
        await post(
          "/api/v1/auth/native",
          { provider: "apple", identityToken: asGoogle, deviceProfileId: "guest1" },
          await guestToken("guest1"),
        )
      ).status,
    ).toBe(401);
    const asApple = await google.idToken({
      sub: "g-ada",
      aud: "tv.rocketcrew.app",
      email_verified: true,
    });
    expect(
      (
        await post(
          "/api/v1/auth/native",
          { provider: "google", identityToken: asApple, deviceProfileId: "guest1" },
          await guestToken("guest1"),
        )
      ).status,
    ).toBe(401);
  });

  it("a tablet guest moving to an existing account keeps the tablet's kind and name", async () => {
    await d1.db.batch([
      d1.db.prepare(
        "INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES ('guest2-ipad', 'guest2', 'tablet', 'Juneau''s iPad')",
      ),
      d1.db.prepare(
        "INSERT INTO profile_logins (provider, subject, profile_id, email) VALUES ('apple', 'apple-ada', 'ada', NULL)",
      ),
    ]);
    const tablet = await tokenFor({ sub: "guest2", did: "guest2-ipad", kind: "tablet" });
    const res = await post(
      "/api/v1/auth/native",
      {
        provider: "apple",
        identityToken: await appleToken("apple-ada"),
        deviceProfileId: "guest2",
      },
      tablet,
    );
    expect(res.status).toBe(200);
    expect(await deviceRow("guest2-ipad")).toEqual({
      profile_id: "ada",
      kind: "tablet",
      name: "Juneau's iPad",
    });
    expect(await readClaims(z.string().parse(res.body.token), SECRET, Date.now())).toMatchObject({
      sub: "ada",
      did: "guest2-ipad",
      kind: "tablet",
    });
  });

  it("a guest device OGS has no row for moves as a phone named Phone", async () => {
    await d1.db
      .prepare(
        "INSERT INTO profile_logins (provider, subject, profile_id, email) VALUES ('apple', 'apple-ada', 'ada', NULL)",
      )
      .run();
    const unknown = await tokenFor({ sub: "guest2", did: "guest2-new", kind: "phone" });
    const res = await post(
      "/api/v1/auth/native",
      {
        provider: "apple",
        identityToken: await appleToken("apple-ada"),
        deviceProfileId: "guest2",
      },
      unknown,
    );
    expect(res.status).toBe(200);
    expect(await deviceRow("guest2-new")).toEqual({
      profile_id: "ada",
      kind: "phone",
      name: "Phone",
    });
  });

  it("a guest backing up with a login it already has: 200, the same profile, no device rows touched", async () => {
    await d1.db
      .prepare(
        "INSERT INTO profile_logins (provider, subject, profile_id, email) VALUES ('apple', 'apple-ada', 'guest1', NULL)",
      )
      .run();
    const elsewhere = await tokenFor({ sub: "guest1", did: "guest1-other", kind: "phone" });
    const res = await post(
      "/api/v1/auth/native",
      {
        provider: "apple",
        identityToken: await appleToken("apple-ada"),
        deviceProfileId: "guest1",
      },
      elsewhere,
    );
    expect(res.status).toBe(200);
    expect(profileId(res.body)).toBe("guest1");
    expect(await readClaims(z.string().parse(res.body.token), SECRET, Date.now())).toMatchObject({
      sub: "guest1",
      did: "guest1-other",
    });
    expect(await deviceRow("guest1-other")).toBeNull();
    expect(
      (await d1.db.prepare("SELECT COUNT(*) AS n FROM profile_logins").first<{ n: number }>())?.n,
    ).toBe(1);
  });

  it("a guest whose profile is gone is 404 profile_not_found, and no login is stored", async () => {
    const ghost = await tokenFor({ sub: "ghost", did: "ghost-phone", kind: "phone" });
    const res = await post(
      "/api/v1/auth/native",
      {
        provider: "apple",
        identityToken: await appleToken("apple-ghost"),
        deviceProfileId: "ghost",
      },
      ghost,
    );
    expect(res.status).toBe(404);
    expect(errorOf(res.body).code).toBe("profile_not_found");
    expect(await loginOwner("apple", "apple-ghost")).toBeUndefined();
  });

  it("without a guest, a login nobody backs up is 404 login_not_found", async () => {
    const res = await post("/api/v1/auth/native", {
      provider: "apple",
      identityToken: await appleToken("apple-nobody"),
      device: { deviceId: "new-phone", kind: "phone", name: "Phone" },
    });
    expect(res.status).toBe(404);
    expect(errorOf(res.body).code).toBe("login_not_found");
  });

  it("without a guest, the device it names is the one that signs in", async () => {
    await d1.db
      .prepare(
        "INSERT INTO profile_logins (provider, subject, profile_id, email) VALUES ('apple', 'apple-ada', 'ada', NULL)",
      )
      .run();
    const res = await post("/api/v1/auth/native", {
      provider: "apple",
      identityToken: await appleToken("apple-ada"),
      device: { deviceId: "ada-ipad", kind: "tablet", name: "Ada's iPad" },
    });
    expect(await deviceRow("ada-ipad")).toEqual({
      profile_id: "ada",
      kind: "tablet",
      name: "Ada's iPad",
    });
    expect(await readClaims(z.string().parse(res.body.token), SECRET, Date.now())).toMatchObject({
      sub: "ada",
      did: "ada-ipad",
      kind: "tablet",
    });
  });
});
