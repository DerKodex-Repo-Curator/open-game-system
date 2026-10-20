import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerApp } from "../src/lib/native-apps";
import { ServiceAccountSchema, storeCredentials } from "../src/lib/push-credentials";
import type { AppDeviceRow } from "../src/lib/push-delivery";
import { pushSenders } from "../src/lib/push-senders";
import { openTestD1, type TestD1 } from "./support/d1";
import { fcmServiceAccount, p8Pem } from "./support/keys";

/**
 * pushSenders().native (ADR 2026-10-18-multi-tenant-push): a white-label app's device is reached with
 * that app's credentials and registration. Real local D1; APNs, FCM and Google OAuth fake at fetch.
 */
const SECRET = "push-senders-native-secret-0123456";
const NOW = 1_760_000_000_000;
let d1: TestD1;
let calls: { url: string; headers: Headers }[];

beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  calls = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url === "https://oauth2.googleapis.com/token")
      return Response.json({ access_token: "ya29.native" });
    return new Response(null, { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

const N = { title: "t", body: "b" };
const iphone = (apns_environment: AppDeviceRow["apns_environment"]): AppDeviceRow => ({
  device_id: "sam-iphone",
  platform: "ios",
  token: "a".repeat(64),
  apns_environment,
});
const PIXEL: AppDeviceRow = {
  device_id: "sam-pixel",
  platform: "android",
  token: "fcm-1",
  apns_environment: null,
};
const senders = () => pushSenders({ DB: d1.db, PUSH_KEY_SECRET: SECRET }, NOW);
const registerIos = () =>
  registerApp(
    d1.db,
    { appId: "rocket-crew", platform: "ios", bundleId: "tv.rocketcrew.app", teamId: "34S957HD77" },
    1,
  );
const uploadIos = async () =>
  expect(
    await storeCredentials(
      d1.db,
      "rocket-crew",
      { ios: { p8: await p8Pem(), keyId: "ABC123DEFG", teamId: "34S957HD77" } },
      SECRET,
      1,
    ),
  ).toBe(true);
const native = (device: AppDeviceRow) => {
  const send = senders().native;
  if (!send) throw new Error("pushSenders has a native sender");
  return send("rocket-crew", device, N);
};

describe("pushSenders: native", { timeout: 20_000 }, () => {
  it("without PUSH_KEY_SECRET nothing is sent", async () => {
    const send = pushSenders({ DB: d1.db }, NOW).native;
    expect(await send?.("rocket-crew", PIXEL, N)).toEqual({
      success: false,
      deviceActive: true,
      error: "push_unavailable",
    });
    expect(calls).toEqual([]);
  });

  it("iOS goes to APNs with the registered bundle id as topic and the app's key, signed now", async () => {
    await registerIos();
    await uploadIos();
    expect(await native(iphone("production"))).toEqual({ success: true, deviceActive: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://api.push.apple.com/3/device/${"a".repeat(64)}`);
    expect(calls[0]?.headers.get("apns-topic")).toBe("tv.rocketcrew.app");
    const jwt = (calls[0]?.headers.get("authorization") ?? "").split(".")[1] ?? "";
    expect(JSON.parse(atob(jwt.replace(/-/g, "+").replace(/_/g, "/")))).toEqual({
      iss: "34S957HD77",
      iat: NOW / 1000,
    });
  });

  it("an iOS device without an APNs environment is treated as production; sandbox goes to the sandbox", async () => {
    await registerIos();
    await uploadIos();
    await native(iphone(null));
    await native(iphone("sandbox"));
    expect(calls.map((c) => new URL(c.url).host)).toEqual([
      "api.push.apple.com",
      "api.sandbox.push.apple.com",
    ]);
  });

  it("iOS without uploaded credentials, or without the registered app, sends nothing", async () => {
    await registerIos();
    expect(await native(iphone("production"))).toEqual({
      success: false,
      deviceActive: true,
      error: "no_apns_credentials",
    });
    await uploadIos();
    await d1.db.prepare("DELETE FROM native_apps").run();
    expect(await native(iphone("production"))).toEqual({
      success: false,
      deviceActive: true,
      error: "no_apns_credentials",
    });
    expect(calls).toEqual([]);
  });

  it("Android goes to FCM with the app's service account", async () => {
    const sa = ServiceAccountSchema.parse(await fcmServiceAccount());
    expect(
      await storeCredentials(d1.db, "rocket-crew", { android: { serviceAccount: sa } }, SECRET, 1),
    ).toBe(true);
    expect(await native(PIXEL)).toEqual({ success: true, deviceActive: true });
    expect(calls.map((c) => c.url)).toEqual([
      sa.token_uri,
      `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    ]);
    expect(calls[1]?.headers.get("authorization")).toBe("Bearer ya29.native");
  });

  it("credentials sealed with another PUSH_KEY_SECRET don't open: nothing is sent", async () => {
    await registerIos();
    await uploadIos();
    const send = pushSenders(
      { DB: d1.db, PUSH_KEY_SECRET: "another-push-key-secret-0123456789" },
      NOW,
    ).native;
    expect(await send?.("rocket-crew", iphone("production"), N)).toEqual({
      success: false,
      deviceActive: true,
      error: "push_credentials_unreadable",
    });
    expect(calls).toEqual([]);
  });

  it("Android without uploaded credentials sends nothing (iOS ones don't count)", async () => {
    await registerIos();
    await uploadIos();
    expect(await native(PIXEL)).toEqual({
      success: false,
      deviceActive: true,
      error: "no_fcm_credentials",
    });
    expect(calls).toEqual([]);
  });
});
