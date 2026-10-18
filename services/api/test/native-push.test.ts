import type { Claims } from "@open-game-system/ogs-protocol";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import app from "../src/index";
import { generateApiKey } from "../src/lib/api-keys";
import { issueToken } from "../src/lib/identity";
import { openTestD1, type TestD1 } from "./support/d1";
import { fcmServiceAccountPair, p8Pair } from "./support/keys";

/**
 * Multi-tenant push (2026-10-18-white-label-apps.feature, "Devices and sending"): a game's push goes
 * to its own white-label app with that app's credentials (APNs ES256 provider token / FCM v1 with an
 * OAuth token from the service account), never to another game's app, and the OGS app keeps Expo.
 * Real local D1; APNs, FCM, Google OAuth and Expo are fakes at fetch.
 */
const SECRET = "native-push-secret";
const PUSH_KEY_SECRET = "push-key-secret-native-push-tests";
const APNS_TOKEN = "a".repeat(64);
const FCM_TOKEN = "fcm-registration-token-1";
let d1: TestD1;
let rcKey: string;
let cbKey: string;
let calls: { url: string; headers: Headers; body: string }[];
let apnsStatus: number;
let fcmStatus: number;

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
  await d1.db.batch([
    d1.db.prepare("INSERT INTO profiles (id, handle, name, sticker) VALUES ('sam', 'sam', 'Sam', 'owl')"),
    ...["sam-iphone", "sam-pixel", "sam-ogs"].map((id) =>
      d1.db.prepare("INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES (?, 'sam', 'phone', 'Phone')").bind(id),
    ),
    ...[
      ["k-rc", "rocket-crew", rc],
      ["k-cb", "codebreakers", cb],
    ].map(([id, appId, k]) =>
      d1.db
        .prepare("INSERT INTO game_api_keys (id, app_id, prefix, key_hash, scope, created_at) VALUES (?, ?, ?, ?, 'notifications:send', 1)")
        .bind(id, appId, typeof k === "string" ? "" : k.prefix, typeof k === "string" ? "" : k.hash),
    ),
  ]);
  calls = [];
  apnsStatus = 200;
  fcmStatus = 200;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers), body: String(init?.body ?? "") });
    if (url.startsWith("https://exp.host/")) return Response.json({ data: [{ status: "ok", id: "t" }] });
    if (url.startsWith("https://api.push.apple.com/") || url.startsWith("https://api.sandbox.push.apple.com/"))
      return apnsStatus === 200 ? new Response(null, { status: 200 }) : Response.json({ reason: "Unregistered" }, { status: apnsStatus });
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "ya29.test", expires_in: 3600, token_type: "Bearer" });
    if (url.startsWith("https://fcm.googleapis.com/"))
      return fcmStatus === 200 ? Response.json({ name: "m/1" }) : Response.json({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }, { status: fcmStatus });
    throw new Error(`unexpected fetch ${url}`);
  });
});
afterEach(() => vi.unstubAllGlobals());

const env = () => ({ DB: d1.db, OGS_JWT_SECRET: SECRET, PUSH_KEY_SECRET });
const tokenFor = (claims: Omit<Claims, "exp">) => issueToken(claims, SECRET, { now: Date.now(), ttlSeconds: 60 });
async function call(method: string, path: string, auth: string | null, body?: unknown) {
  const res = await app.request(
    path,
    { method, headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) },
    env(),
  );
  const text = await res.text();
  return { status: res.status, body: text ? z.record(z.string(), z.unknown()).parse(JSON.parse(text)) : {} };
}
const phone = (did: string) => tokenFor({ sub: "sam", did, kind: "phone" });
const handleFor = async (appId: string) => z.string().parse((await call("POST", `/api/v1/games/${appId}/push-handles`, await phone("sam-iphone"), {})).body.handle);
const send = (appId: string, key: string, handle: string) =>
  call("POST", `/api/v1/games/${appId}/notifications`, key, { to: [handle], title: "Launch window", body: "Your crew is waiting." });
const statusOf = (res: { body: Record<string, unknown> }) =>
  z.object({ results: z.array(z.object({ status: z.string() })) }).parse(res.body).results[0]?.status;

const b64urlBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const jwtParts = (jwt: string) => {
  const [h = "", p = "", sig = ""] = jwt.split(".");
  return { header: JSON.parse(new TextDecoder().decode(b64urlBytes(h))), claims: JSON.parse(new TextDecoder().decode(b64urlBytes(p))), signed: new TextEncoder().encode(`${h}.${p}`), sig: b64urlBytes(sig) };
};

async function setUpIos() {
  const key = await p8Pair();
  await call("PUT", "/api/v1/apps/rocket-crew/native/ios", rcKey, { bundleId: "tv.rocketcrew.app", teamId: "34S957HD77" });
  await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, { ios: { p8: key.pem, keyId: "ABC123DEFG", teamId: "34S957HD77" } });
  await call("PUT", "/api/v1/apps/rocket-crew/devices/sam-iphone", await phone("sam-iphone"), { platform: "ios", token: APNS_TOKEN, apnsEnvironment: "production" });
  return key;
}

describe("a game's push reaches its own white-label app", { timeout: 20_000 }, () => {
  it("APNs: apns-topic is the app's bundle id, signed with the app's key id and team id", async () => {
    const key = await setUpIos();
    const res = await send("rocket-crew", rcKey, await handleFor("rocket-crew"));
    expect(statusOf(res)).toBe("sent");
    const apns = calls.find((c) => c.url.startsWith("https://api.push.apple.com/3/device/"));
    expect(apns?.url).toBe(`https://api.push.apple.com/3/device/${APNS_TOKEN}`);
    expect(apns?.headers.get("apns-topic")).toBe("tv.rocketcrew.app");
    expect(apns?.headers.get("apns-push-type")).toBe("alert");
    const jwt = jwtParts((apns?.headers.get("authorization") ?? "").replace(/^bearer /, ""));
    expect(jwt.header).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(jwt.claims.iss).toBe("34S957HD77");
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key.publicKey, jwt.sig, jwt.signed)).toBe(true);
    const payload = JSON.parse(apns?.body ?? "{}");
    expect(payload.aps.alert).toEqual({ title: "Launch window", body: "Your crew is waiting." });
    expect(payload.ogs).toMatchObject({ type: "game-push", appId: "rocket-crew" });
  });

  it("a sandbox build's token goes to APNs' sandbox", async () => {
    await setUpIos();
    await call("PUT", "/api/v1/apps/rocket-crew/devices/sam-iphone", await phone("sam-iphone"), { platform: "ios", token: APNS_TOKEN, apnsEnvironment: "sandbox" });
    await send("rocket-crew", rcKey, await handleFor("rocket-crew"));
    expect(calls.some((c) => c.url === `https://api.sandbox.push.apple.com/3/device/${APNS_TOKEN}`)).toBe(true);
  });

  it("Android: FCM v1 for the service account's project, with an OAuth token from that account", async () => {
    const { serviceAccount, publicKey } = await fcmServiceAccountPair();
    const fp = Array.from({ length: 32 }, () => "AB").join(":");
    await call("PUT", "/api/v1/apps/rocket-crew/native/android", rcKey, { package: "tv.rocketcrew.app", sha256CertFingerprints: [fp], googleClientIds: [] });
    await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, { android: { serviceAccount } });
    await call("PUT", "/api/v1/apps/rocket-crew/devices/sam-pixel", await phone("sam-pixel"), { platform: "android", token: FCM_TOKEN });
    const res = await send("rocket-crew", rcKey, await handleFor("rocket-crew"));
    expect(statusOf(res)).toBe("sent");
    const oauth = calls.find((c) => c.url === "https://oauth2.googleapis.com/token");
    const assertion = new URLSearchParams(oauth?.body).get("assertion") ?? "";
    const jwt = jwtParts(assertion);
    expect(jwt.claims).toMatchObject({ iss: serviceAccount.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token" });
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, jwt.sig, jwt.signed)).toBe(true);
    const fcm = calls.find((c) => c.url.startsWith("https://fcm.googleapis.com/"));
    expect(fcm?.url).toBe(`https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`);
    expect(fcm?.headers.get("authorization")).toBe("Bearer ya29.test");
    expect(JSON.parse(fcm?.body ?? "{}").message).toMatchObject({ token: FCM_TOKEN, notification: { title: "Launch window", body: "Your crew is waiting." } });
  });

  it("another game's push never reaches Rocket Crew's app", async () => {
    await setUpIos();
    await send("codebreakers", cbKey, await handleFor("codebreakers"));
    expect(calls.some((c) => c.url.includes(APNS_TOKEN))).toBe(false);
  });

  it("the OGS app still gets the game's push through Expo, alongside", async () => {
    await setUpIos();
    await d1.db.prepare("INSERT INTO devices (ogs_device_id, platform, push_token) VALUES ('sam-ogs', 'ios', 'ExponentPushToken[sam]')").run();
    await send("rocket-crew", rcKey, await handleFor("rocket-crew"));
    expect(calls.some((c) => c.url.startsWith("https://exp.host/"))).toBe(true);
    expect(calls.some((c) => c.url.includes(APNS_TOKEN))).toBe(true);
  });

  it("a token APNs says is gone (410) is removed", async () => {
    await setUpIos();
    apnsStatus = 410;
    const res = await send("rocket-crew", rcKey, await handleFor("rocket-crew"));
    expect(statusOf(res)).not.toBe("sent");
    expect((await d1.db.prepare("SELECT COUNT(*) AS n FROM app_devices").first<{ n: number }>())?.n).toBe(0);
  });

  it("an app with no credentials uploaded: nothing is sent to it, and the result is failed", async () => {
    await call("PUT", "/api/v1/apps/rocket-crew/native/ios", rcKey, { bundleId: "tv.rocketcrew.app", teamId: "34S957HD77" });
    await call("PUT", "/api/v1/apps/rocket-crew/devices/sam-iphone", await phone("sam-iphone"), { platform: "ios", token: APNS_TOKEN, apnsEnvironment: "production" });
    const res = await send("rocket-crew", rcKey, await handleFor("rocket-crew"));
    expect(statusOf(res)).toBe("failed");
    expect(calls.some((c) => c.url.includes("push.apple.com"))).toBe(false);
  });
});
