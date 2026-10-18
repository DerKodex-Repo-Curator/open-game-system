import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import app from "../src/index";
import { generateApiKey } from "../src/lib/api-keys";
import { openTestD1, type TestD1 } from "./support/d1";
import { fcmServiceAccount, p8Pem } from "./support/keys";

/**
 * White-label apps (docs/acceptance/2026-10-18-white-label-apps.feature): registering a game's
 * iOS / Android app and uploading its push credentials, with the game's API key. Real local D1.
 */
const SECRET = "native-apps-secret";
const PUSH_KEY_SECRET = "push-key-secret-for-tests-0123456789";
let d1: TestD1;
let rcKey: string;
let cbKey: string;

beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  const rc = await generateApiKey();
  const cb = await generateApiKey();
  rcKey = rc.key;
  cbKey = cb.key;
  await d1.db.batch(
    [
      ["k-rc", "rocket-crew", rc],
      ["k-cb", "codebreakers", cb],
    ].map(([id, appId, k]) =>
      d1.db
        .prepare(
          "INSERT INTO game_api_keys (id, app_id, prefix, key_hash, scope, created_at) VALUES (?, ?, ?, ?, 'notifications:send', 1)",
        )
        .bind(id, appId, typeof k === "string" ? "" : k.prefix, typeof k === "string" ? "" : k.hash),
    ),
  );
});

const env = () => ({ DB: d1.db, OGS_JWT_SECRET: SECRET, PUSH_KEY_SECRET });
async function call(method: string, path: string, auth: string | null, body?: unknown) {
  const res = await app.request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env(),
  );
  const text = await res.text();
  return { status: res.status, body: text ? z.record(z.string(), z.unknown()).parse(JSON.parse(text)) : {} };
}
const IOS = { bundleId: "tv.rocketcrew.app", teamId: "34S957HD77" };
const FINGERPRINT = Array.from({ length: 32 }, (_, i) => (i * 7).toString(16).padStart(2, "0").toUpperCase()).join(":");
const ANDROID = { package: "tv.rocketcrew.app", sha256CertFingerprints: [FINGERPRINT], googleClientIds: ["123-abc.apps.googleusercontent.com"] };
const errorCode = (body: Record<string, unknown>) => z.object({ error: z.object({ code: z.string() }) }).parse(body).error.code;

describe("registering a game's app", () => {
  it("registers the iOS app (201), then updates it (200)", async () => {
    const first = await call("PUT", "/api/v1/apps/rocket-crew/native/ios", rcKey, IOS);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ appId: "rocket-crew", platform: "ios", bundleId: "tv.rocketcrew.app", teamId: "34S957HD77" });
    expect((await call("PUT", "/api/v1/apps/rocket-crew/native/ios", rcKey, { ...IOS, teamId: "ABCDE12345" })).status).toBe(200);
    const list = await call("GET", "/api/v1/apps/rocket-crew/native", rcKey);
    expect(list.body).toMatchObject({ apps: [{ platform: "ios", bundleId: "tv.rocketcrew.app", teamId: "ABCDE12345" }] });
  });

  it("registers the Android app with its fingerprints and Google client ids", async () => {
    const res = await call("PUT", "/api/v1/apps/rocket-crew/native/android", rcKey, ANDROID);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ platform: "android", package: "tv.rocketcrew.app", sha256CertFingerprints: [FINGERPRINT], googleClientIds: ANDROID.googleClientIds });
  });

  it("needs this game's key: another game's is 403, none is 401", async () => {
    expect(errorCode((await call("PUT", "/api/v1/apps/rocket-crew/native/ios", cbKey, IOS)).body)).toBe("wrong_game");
    expect((await call("PUT", "/api/v1/apps/rocket-crew/native/ios", null, IOS)).status).toBe(401);
  });

  it("a bundle id or package belongs to one game (409 app_id_taken)", async () => {
    await call("PUT", "/api/v1/apps/rocket-crew/native/ios", rcKey, IOS);
    const res = await call("PUT", "/api/v1/apps/codebreakers/native/ios", cbKey, IOS);
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe("app_id_taken");
  });

  it.each([
    ["ios", { bundleId: "not a bundle id", teamId: "34S957HD77" }],
    ["ios", { bundleId: "tv.rocketcrew.app", teamId: "ABC" }],
    ["android", { ...ANDROID, sha256CertFingerprints: ["AB:CD"] }],
    ["android", { ...ANDROID, package: "Bad Package" }],
    ["android", { ...ANDROID, googleClientIds: ["not-a-client-id"] }],
  ])("refuses a bad %s registration (400, nothing stored)", async (platform, body) => {
    const res = await call("PUT", `/api/v1/apps/rocket-crew/native/${platform}`, rcKey, body);
    expect(res.status).toBe(400);
    const list = await call("GET", "/api/v1/apps/rocket-crew/native", rcKey);
    expect(list.body).toEqual({ apps: [] });
  });
});

describe("push credentials", () => {
  it("stores the APNs key encrypted and says what's configured, never the key", async () => {
    await call("PUT", "/api/v1/apps/rocket-crew/native/ios", rcKey, IOS);
    const p8 = await p8Pem();
    const res = await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, { ios: { p8, keyId: "ABC123DEFG", teamId: "34S957HD77" } });
    expect(res.status).toBe(204);
    const { results } = await d1.db.prepare("SELECT * FROM app_push_credentials").all();
    expect(JSON.stringify(results)).not.toContain(p8.split("\n")[1] ?? "unreachable");
    expect(JSON.stringify(results)).not.toContain("PRIVATE KEY");
    const got = await call("GET", "/api/v1/apps/rocket-crew/push-credentials", rcKey);
    expect(got.body).toEqual({ ios: { configured: true, keyId: "ABC123DEFG", teamId: "34S957HD77", bundleId: "tv.rocketcrew.app" }, android: { configured: false } });
  });

  it("stores the FCM service account and shows its project and client email only", async () => {
    await call("PUT", "/api/v1/apps/rocket-crew/native/android", rcKey, ANDROID);
    const sa = await fcmServiceAccount();
    expect((await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, { android: { serviceAccount: sa } })).status).toBe(204);
    const got = await call("GET", "/api/v1/apps/rocket-crew/push-credentials", rcKey);
    expect(got.body).toMatchObject({ android: { configured: true, projectId: sa.project_id, clientEmail: sa.client_email, package: "tv.rocketcrew.app" } });
    expect(JSON.stringify(got.body)).not.toContain("PRIVATE KEY");
  });

  it("refuses credentials for an app that isn't registered (409 app_not_registered)", async () => {
    const res = await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, { ios: { p8: await p8Pem(), keyId: "ABC123DEFG", teamId: "34S957HD77" } });
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe("app_not_registered");
  });

  it("refuses a key that isn't a key (400 invalid_credentials)", async () => {
    await call("PUT", "/api/v1/apps/rocket-crew/native/ios", rcKey, IOS);
    await call("PUT", "/api/v1/apps/rocket-crew/native/android", rcKey, ANDROID);
    const badP8 = await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, { ios: { p8: "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----", keyId: "ABC123DEFG", teamId: "34S957HD77" } });
    expect(errorCode(badP8.body)).toBe("invalid_credentials");
    const sa = await fcmServiceAccount();
    const badSa = await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, { android: { serviceAccount: { ...sa, private_key: "nope" } } });
    expect(errorCode(badSa.body)).toBe("invalid_credentials");
    expect((await d1.db.prepare("SELECT COUNT(*) AS n FROM app_push_credentials").first<{ n: number }>())?.n).toBe(0);
  });

  it("needs PUSH_KEY_SECRET to store anything (503)", async () => {
    await call("PUT", "/api/v1/apps/rocket-crew/native/ios", rcKey, IOS);
    const res = await app.request(
      "/api/v1/apps/rocket-crew/push-credentials",
      { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${rcKey}` }, body: JSON.stringify({ ios: { p8: await p8Pem(), keyId: "ABC123DEFG", teamId: "34S957HD77" } }) },
      { DB: d1.db, OGS_JWT_SECRET: SECRET },
    );
    expect(res.status).toBe(503);
  });
});

describe("app links (public)", () => {
  it("lists every registered app for opengame.org's link files", async () => {
    await call("PUT", "/api/v1/apps/rocket-crew/native/ios", rcKey, IOS);
    await call("PUT", "/api/v1/apps/rocket-crew/native/android", rcKey, ANDROID);
    const res = await call("GET", "/api/v1/apps/app-links", null);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ios: [{ appId: "rocket-crew", appleAppId: "34S957HD77.tv.rocketcrew.app" }],
      android: [{ appId: "rocket-crew", package: "tv.rocketcrew.app", sha256CertFingerprints: [FINGERPRINT] }],
    });
  });
});
