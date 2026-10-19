import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import app from "../src/index";
import { generateApiKey } from "../src/lib/api-keys";
import {
  allApps,
  appLinks,
  appOf,
  appsOf,
  registerApp,
  signInAudiences,
} from "../src/lib/native-apps";
import { openTestD1, type TestD1 } from "./support/d1";
import { fcmServiceAccount, p8Pem } from "./support/keys";

/**
 * /api/v1/apps in detail (docs/acceptance/2026-10-18-white-label-apps.feature): what each route
 * answers and what it stores, so a change to any of it shows. Real local D1.
 */
const SECRET = "apps-routes-secret";
const PUSH_KEY_SECRET = "push-key-secret-for-apps-routes-0123";
let d1: TestD1;
let rcKey: string;

beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  const rc = await generateApiKey();
  rcKey = rc.key;
  await d1.db
    .prepare(
      "INSERT INTO game_api_keys (id, app_id, prefix, key_hash, scope, created_at) VALUES ('k-rc', 'rocket-crew', ?, ?, 'notifications:send', 1)",
    )
    .bind(rc.prefix, rc.hash)
    .run();
});
afterEach(() => vi.useRealTimers());

const env = () => ({ DB: d1.db, OGS_JWT_SECRET: SECRET, PUSH_KEY_SECRET });
async function call(
  method: string,
  path: string,
  auth: string | null,
  body?: unknown,
  rawBody?: string,
) {
  const res = await app.request(
    path,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    },
    env(),
  );
  const text = await res.text();
  const json = res.headers.get("content-type")?.includes("application/json");
  return { status: res.status, headers: res.headers, body: text && json ? JSON.parse(text) : {} };
}
const errorOf = (body: unknown) =>
  z
    .object({ error: z.object({ code: z.string(), message: z.string(), status: z.number() }) })
    .parse(body).error;

const IOS = { bundleId: "tv.rocketcrew.app", teamId: "34S957HD77" };
const FP = Array.from({ length: 32 }, (_, i) =>
  (i * 7).toString(16).padStart(2, "0").toUpperCase(),
).join(":");
const ANDROID = {
  package: "tv.rocketcrew.app",
  sha256CertFingerprints: [FP],
  googleClientIds: ["123-abc.apps.googleusercontent.com"],
};
const row = (platform: string) =>
  d1.db
    .prepare(
      "SELECT app_id, platform, store_id, team_id, sha256_fingerprints, google_client_ids, created_at, updated_at FROM native_apps WHERE platform = ?",
    )
    .bind(platform)
    .first();
const putIos = (body: unknown) => call("PUT", "/api/v1/apps/rocket-crew/native/ios", rcKey, body);
const putAndroid = (body: unknown) =>
  call("PUT", "/api/v1/apps/rocket-crew/native/android", rcKey, body);
const IOS_MESSAGE = "bundleId (reverse DNS) and teamId (10 letters/digits) are required";
const ANDROID_MESSAGE =
  "package, sha256CertFingerprints (32 hex pairs each) and googleClientIds (…apps.googleusercontent.com) are required";

describe("the public link routes", { timeout: 20_000 }, () => {
  it.each([
    "/api/v1/apps/app-links",
    "/api/v1/apps/apple-app-site-association",
    "/api/v1/apps/assetlinks.json",
  ])("%s may be cached for five minutes", async (path) => {
    const res = await call("GET", path, null);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("app-links with nothing registered is two empty lists", async () => {
    expect((await call("GET", "/api/v1/apps/app-links", null)).body).toEqual({
      ios: [],
      android: [],
    });
  });

  it("the link documents carry every registered app, first", async () => {
    await putIos(IOS);
    await putAndroid(ANDROID);
    const aasa = await call("GET", "/api/v1/apps/apple-app-site-association", null);
    expect(aasa.body.applinks.details[0]).toEqual({
      appID: "34S957HD77.tv.rocketcrew.app",
      paths: ["/play/rocket-crew", "/play/rocket-crew/*"],
    });
    expect(aasa.body.applinks.apps).toEqual([]);
    const links = await call("GET", "/api/v1/apps/assetlinks.json", null);
    expect(links.body[0]).toEqual({
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "tv.rocketcrew.app",
        sha256_cert_fingerprints: [FP],
      },
    });
    expect(links.body).toHaveLength(2);
  });
});

describe("PUT /:appId/native/:platform", { timeout: 20_000 }, () => {
  it("stores an iOS app's team id and empty Android columns", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
    await putIos(IOS);
    expect(await row("ios")).toEqual({
      app_id: "rocket-crew",
      platform: "ios",
      store_id: "tv.rocketcrew.app",
      team_id: "34S957HD77",
      sha256_fingerprints: "[]",
      google_client_ids: "[]",
      created_at: 1_000,
      updated_at: 1_000,
    });
  });

  it("stores an Android app's fingerprints and client ids, no team id", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(2_000);
    expect((await putAndroid(ANDROID)).body).toEqual({
      appId: "rocket-crew",
      platform: "android",
      ...ANDROID,
    });
    expect(await row("android")).toEqual({
      app_id: "rocket-crew",
      platform: "android",
      store_id: "tv.rocketcrew.app",
      team_id: null,
      sha256_fingerprints: JSON.stringify([FP]),
      google_client_ids: JSON.stringify(ANDROID.googleClientIds),
      created_at: 2_000,
      updated_at: 2_000,
    });
  });

  it("an update keeps created_at, moves updated_at and answers 200 with the app", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
    await putAndroid(ANDROID);
    vi.setSystemTime(5_000);
    const res = await putAndroid({
      ...ANDROID,
      package: "tv.rocketcrew.beta",
      googleClientIds: [],
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      appId: "rocket-crew",
      platform: "android",
      ...ANDROID,
      package: "tv.rocketcrew.beta",
      googleClientIds: [],
    });
    expect(await row("android")).toMatchObject({
      store_id: "tv.rocketcrew.beta",
      google_client_ids: "[]",
      created_at: 1_000,
      updated_at: 5_000,
    });
  });

  it("fingerprints are stored upper case, and googleClientIds defaults to none", async () => {
    const res = await putAndroid({
      package: "tv.rocketcrew.app",
      sha256CertFingerprints: [FP.toLowerCase()],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ sha256CertFingerprints: [FP], googleClientIds: [] });
  });

  it("the same id on the other platform is not taken: a bundle id and a package are separate", async () => {
    await d1.db
      .prepare(
        "INSERT INTO native_apps (app_id, platform, store_id, team_id, created_at, updated_at) VALUES ('codebreakers', 'ios', 'tv.rocketcrew.app', '34S957HD77', 1, 1)",
      )
      .run();
    expect((await putAndroid(ANDROID)).status).toBe(201);
    const taken = await putIos(IOS);
    expect(taken.status).toBe(409);
    expect(errorOf(taken.body)).toEqual({
      code: "app_id_taken",
      message: "That bundle id / package is registered to another game",
      status: 409,
    });
  });

  it("a package another game has is taken", async () => {
    await d1.db
      .prepare(
        "INSERT INTO native_apps (app_id, platform, store_id, sha256_fingerprints, google_client_ids, created_at, updated_at) VALUES ('codebreakers', 'android', 'tv.rocketcrew.app', '[]', '[]', 1, 1)",
      )
      .run();
    expect((await putAndroid(ANDROID)).status).toBe(409);
    expect(await row("android")).toMatchObject({ app_id: "codebreakers" });
  });

  it.each([
    ["ios", { teamId: "34S957HD77" }, IOS_MESSAGE],
    ["android", { package: "tv.rocketcrew.app" }, ANDROID_MESSAGE],
  ])("a bad %s body says what's required", async (platform, body, message) => {
    const res = await call("PUT", `/api/v1/apps/rocket-crew/native/${platform}`, rcKey, body);
    expect(errorOf(res.body)).toEqual({ code: "invalid_body", message, status: 400 });
  });

  it("a body that isn't JSON is 400", async () => {
    expect(
      (await call("PUT", "/api/v1/apps/rocket-crew/native/ios", rcKey, undefined, "{")).status,
    ).toBe(400);
  });

  it("another platform is 404", async () => {
    expect((await call("PUT", "/api/v1/apps/rocket-crew/native/windows", rcKey, IOS)).status).toBe(
      404,
    );
  });

  it.each([
    ["a bundle id starting with a digit", { ...IOS, bundleId: "1tv.rocketcrew" }],
    ["a bundle id with one part", { ...IOS, bundleId: "rocketcrew" }],
    ["a bundle id with a trailing space", { ...IOS, bundleId: "tv.rocketcrew " }],
    ["a bundle id with a leading dot", { ...IOS, bundleId: ".tv.rocketcrew" }],
    ["a bundle id over 155 characters", { ...IOS, bundleId: `tv.${"a".repeat(153)}` }],
    ["a team id of 11", { ...IOS, teamId: "34S957HD77X" }],
    ["a lower-case team id", { ...IOS, teamId: "34s957hd77" }],
    ["a team id with a prefix", { ...IOS, teamId: "x34S957HD77" }],
  ])("refuses %s", async (_what, body) => {
    expect((await putIos(body)).status).toBe(400);
  });

  it("accepts a 155-character bundle id with hyphens and digits", async () => {
    expect((await putIos({ ...IOS, bundleId: `T-v.a-1.${"b".repeat(147)}` })).status).toBe(201);
  });

  it.each([
    ["an upper-case package", { ...ANDROID, package: "Tv.rocketcrew" }],
    ["a package with one part", { ...ANDROID, package: "rocketcrew" }],
    ["a package part starting with a digit", { ...ANDROID, package: "tv.1rocket" }],
    ["a package with a suffix", { ...ANDROID, package: "tv.rocketcrew!" }],
    ["a package with a prefix", { ...ANDROID, package: "!tv.rocketcrew" }],
    ["a package over 150 characters", { ...ANDROID, package: `tv.${"a".repeat(148)}` }],
    ["no fingerprints", { ...ANDROID, sha256CertFingerprints: [] }],
    ["eleven fingerprints", { ...ANDROID, sha256CertFingerprints: Array(11).fill(FP) }],
    ["a fingerprint of 31 pairs", { ...ANDROID, sha256CertFingerprints: [FP.slice(3)] }],
    ["a fingerprint of 33 pairs", { ...ANDROID, sha256CertFingerprints: [`AB:${FP}`] }],
    ["a fingerprint with a trailing colon", { ...ANDROID, sha256CertFingerprints: [`${FP}:`] }],
    ["a fingerprint with a prefix", { ...ANDROID, sha256CertFingerprints: [`x${FP}`] }],
    [
      "a fingerprint that isn't hex",
      { ...ANDROID, sha256CertFingerprints: [FP.replace(/^../, "GG")] },
    ],
    [
      "eleven Google client ids",
      { ...ANDROID, googleClientIds: Array(11).fill("123-abc.apps.googleusercontent.com") },
    ],
    [
      "a client id without its number",
      { ...ANDROID, googleClientIds: ["-abc.apps.googleusercontent.com"] },
    ],
    [
      "a client id with a prefix",
      { ...ANDROID, googleClientIds: ["x123-abc.apps.googleusercontent.com"] },
    ],
    [
      "a client id with a suffix",
      { ...ANDROID, googleClientIds: ["123-abc.apps.googleusercontent.com.evil"] },
    ],
    [
      "a client id on another domain",
      { ...ANDROID, googleClientIds: ["123-abc.appsXgoogleusercontent.com"] },
    ],
    [
      "a client id with no name",
      { ...ANDROID, googleClientIds: ["123-.apps.googleusercontent.com"] },
    ],
  ])("refuses %s", async (_what, body) => {
    expect((await putAndroid(body)).status).toBe(400);
  });

  it("accepts the limits: a 150-character package, ten fingerprints, ten client ids, underscores", async () => {
    const res = await putAndroid({
      package: `tv.a_1.${"b".repeat(143)}`,
      sha256CertFingerprints: Array(10).fill(FP),
      googleClientIds: Array(10).fill("123-abc.apps.googleusercontent.com"),
    });
    expect(res.status).toBe(201);
  });
});

describe("GET /:appId/native", { timeout: 20_000 }, () => {
  it("lists iOS first, then Android, and only this game's", async () => {
    await putAndroid(ANDROID);
    await putIos(IOS);
    await d1.db
      .prepare(
        "INSERT INTO native_apps (app_id, platform, store_id, team_id, created_at, updated_at) VALUES ('codebreakers', 'ios', 'org.codebreakers', 'ABCDE12345', 1, 1)",
      )
      .run();
    const res = await call("GET", "/api/v1/apps/rocket-crew/native", rcKey);
    expect(res.body).toEqual({
      apps: [
        { appId: "rocket-crew", platform: "ios", ...IOS },
        { appId: "rocket-crew", platform: "android", ...ANDROID },
      ],
    });
  });

  it("an iOS row without a team id reads as an empty team id", async () => {
    await d1.db
      .prepare(
        "INSERT INTO native_apps (app_id, platform, store_id, created_at, updated_at) VALUES ('rocket-crew', 'ios', 'tv.rocketcrew.app', 1, 1)",
      )
      .run();
    expect((await call("GET", "/api/v1/apps/rocket-crew/native", rcKey)).body).toEqual({
      apps: [{ appId: "rocket-crew", platform: "ios", bundleId: "tv.rocketcrew.app", teamId: "" }],
    });
  });

  it("needs the game's key", async () => {
    expect((await call("GET", "/api/v1/apps/rocket-crew/native", null)).status).toBe(401);
  });
});

describe("PUT and GET /:appId/push-credentials", { timeout: 20_000 }, () => {
  it("with nothing uploaded, neither platform is configured", async () => {
    expect((await call("GET", "/api/v1/apps/rocket-crew/push-credentials", rcKey)).body).toEqual({
      ios: { configured: false },
      android: { configured: false },
    });
  });

  it("503 says why without PUSH_KEY_SECRET", async () => {
    const res = await app.request(
      "/api/v1/apps/rocket-crew/push-credentials",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${rcKey}` },
        body: "{}",
      },
      { DB: d1.db, OGS_JWT_SECRET: SECRET },
    );
    expect(errorOf(await res.json())).toEqual({
      code: "push_unavailable",
      message: "Push credentials can't be stored here (no PUSH_KEY_SECRET)",
      status: 503,
    });
  });

  it("a bad body says the two shapes", async () => {
    const res = await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, {
      windows: {},
    });
    expect(errorOf(res.body)).toEqual({
      code: "invalid_body",
      message: "{ ios: { p8, keyId, teamId } } or { android: { serviceAccount } } is required",
      status: 400,
    });
  });

  it.each([
    [
      "ios",
      async () => ({ ios: { p8: await p8Pem(), keyId: "ABC123DEFG", teamId: "34S957HD77" } }),
    ],
    ["android", async () => ({ android: { serviceAccount: await fcmServiceAccount() } })],
  ])("credentials for an unregistered %s app say how to register it", async (platform, body) => {
    const res = await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, await body());
    expect(errorOf(res.body)).toEqual({
      code: "app_not_registered",
      message: `Register the ${platform} app first (PUT /api/v1/apps/rocket-crew/native/${platform})`,
      status: 409,
    });
  });

  it("Android credentials need the Android app, not the iOS one", async () => {
    await putIos(IOS);
    const res = await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, {
      android: { serviceAccount: await fcmServiceAccount() },
    });
    expect(res.status).toBe(409);
  });

  it("an unusable key says which kind of key it had to be", async () => {
    await putIos(IOS);
    await putAndroid(ANDROID);
    const p8 = await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, {
      ios: { p8: "nope", keyId: "ABC123DEFG", teamId: "34S957HD77" },
    });
    expect(errorOf(p8.body)).toEqual({
      code: "invalid_credentials",
      message: "The .p8 isn't a P-256 PKCS#8 private key",
      status: 400,
    });
    const sa = await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, {
      android: { serviceAccount: { ...(await fcmServiceAccount()), private_key: "nope" } },
    });
    expect(errorOf(sa.body)).toEqual({
      code: "invalid_credentials",
      message: "The service account's private_key isn't an RSA PKCS#8 key",
      status: 400,
    });
  });

  it("configured credentials whose app row is gone show a null bundle id / package", async () => {
    await putIos(IOS);
    await putAndroid(ANDROID);
    await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, {
      ios: { p8: await p8Pem(), keyId: "ABC123DEFG", teamId: "34S957HD77" },
    });
    const sa = await fcmServiceAccount();
    await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, {
      android: { serviceAccount: sa },
    });
    const both = await call("GET", "/api/v1/apps/rocket-crew/push-credentials", rcKey);
    expect(both.body).toEqual({
      ios: {
        configured: true,
        keyId: "ABC123DEFG",
        teamId: "34S957HD77",
        bundleId: "tv.rocketcrew.app",
      },
      android: {
        configured: true,
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        package: "tv.rocketcrew.app",
      },
    });
    await d1.db.prepare("DELETE FROM native_apps").run();
    const gone = await call("GET", "/api/v1/apps/rocket-crew/push-credentials", rcKey);
    expect(gone.body).toEqual({
      ios: { configured: true, keyId: "ABC123DEFG", teamId: "34S957HD77", bundleId: null },
      android: {
        configured: true,
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        package: null,
      },
    });
  });
});

describe("native-apps", { timeout: 20_000 }, () => {
  const ios = { appId: "rocket-crew", platform: "ios" as const, ...IOS };
  const android = { appId: "rocket-crew", platform: "android" as const, ...ANDROID };

  it("registerApp: created, then updated, and taken for another game's id", async () => {
    expect(await registerApp(d1.db, ios, 1)).toEqual({ status: "created", app: ios });
    expect(await registerApp(d1.db, ios, 2)).toEqual({ status: "updated", app: ios });
    expect(await registerApp(d1.db, { ...ios, appId: "codebreakers" }, 3)).toEqual({
      status: "taken",
    });
  });

  it("appOf finds by game and platform; allApps orders by game, iOS first", async () => {
    await registerApp(d1.db, android, 1);
    await registerApp(d1.db, { ...ios, appId: "zebra", bundleId: "tv.zebra" }, 1);
    await registerApp(d1.db, { ...ios, appId: "alpha", bundleId: "tv.alpha" }, 1);
    await registerApp(d1.db, { ...ios, bundleId: "tv.rocketcrew.ios" }, 1);
    expect(await appOf(d1.db, "rocket-crew", "android")).toEqual(android);
    expect(await appOf(d1.db, "alpha", "android")).toBeNull();
    expect((await allApps(d1.db)).map((a) => `${a.appId}/${a.platform}`)).toEqual([
      "alpha/ios",
      "rocket-crew/ios",
      "rocket-crew/android",
      "zebra/ios",
    ]);
    expect((await appsOf(d1.db, "rocket-crew")).map((a) => a.platform)).toEqual(["ios", "android"]);
  });

  it("appLinks: iOS as team.bundle, Android with its fingerprints", async () => {
    await registerApp(d1.db, ios, 1);
    await registerApp(d1.db, android, 1);
    expect(await appLinks(d1.db)).toEqual({
      ios: [{ appId: "rocket-crew", appleAppId: "34S957HD77.tv.rocketcrew.app" }],
      android: [
        { appId: "rocket-crew", package: "tv.rocketcrew.app", sha256CertFingerprints: [FP] },
      ],
    });
  });

  it("signInAudiences: Apple is the bundle ids, Google the Android apps' client ids", async () => {
    await registerApp(d1.db, ios, 1);
    await registerApp(d1.db, android, 1);
    await registerApp(
      d1.db,
      {
        ...android,
        appId: "codebreakers",
        package: "org.codebreakers",
        googleClientIds: ["9-x.apps.googleusercontent.com", "8-y.apps.googleusercontent.com"],
      },
      1,
    );
    expect(await signInAudiences(d1.db, "apple")).toEqual(["tv.rocketcrew.app"]);
    expect(await signInAudiences(d1.db, "google")).toEqual([
      "9-x.apps.googleusercontent.com",
      "8-y.apps.googleusercontent.com",
      "123-abc.apps.googleusercontent.com",
    ]);
  });
});
