import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type AppDeviceRow,
  deliver,
  type PushMessage,
  type PushSenders,
} from "../src/lib/push-delivery";
import { grantOgs } from "../src/lib/push-handles";
import type { PushNotification, PushResult } from "../src/providers/push";
import { openTestD1, type TestD1 } from "./support/d1";

/**
 * Delivering to a profile's phones running the game's own white-label app (ADR
 * 2026-10-18-multi-tenant-push), alongside the OGS app: which devices, and what a refusal does.
 */
let d1: TestD1;
let sent: { to: string; appId?: string; device?: AppDeviceRow; n: PushNotification }[];
let expoResult: PushResult;
let nativeResults: Record<string, PushResult>;

const OK: PushResult = { success: true, deviceActive: true };
const senders: PushSenders = {
  expo: async (_platform, token, n) => {
    sent.push({ to: `expo:${token}`, n });
    return expoResult;
  },
  web: async () => "ok",
  native: async (appId, device, n) => {
    sent.push({ to: `native:${device.device_id}`, appId, device, n });
    return nativeResults[device.device_id] ?? OK;
  },
};
const message: PushMessage = {
  appId: "rocket-crew",
  title: "Launch window",
  body: "Your crew is waiting.",
  url: "https://rocketcrew.tv/room/1",
  whenOpen: "banner",
};

beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  sent = [];
  expoResult = OK;
  nativeResults = {};
  await d1.db.batch([
    ...["sam", "kim"].map((id) =>
      d1.db
        .prepare("INSERT INTO profiles (id, handle, name, sticker) VALUES (?, ?, ?, 'owl')")
        .bind(id, id, id),
    ),
    ...[
      ["sam-iphone", "sam", "phone"],
      ["sam-pixel", "sam", "phone"],
      ["sam-ipad", "sam", "tablet"],
      ["kim-iphone", "kim", "phone"],
    ].map(([id, profile, kind]) =>
      d1.db
        .prepare(
          "INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES (?, ?, ?, 'Device')",
        )
        .bind(id, profile, kind),
    ),
  ]);
});

const addAppDevice = (
  deviceId: string,
  appId: string,
  platform: "ios" | "android",
  env: string | null,
) =>
  d1.db
    .prepare(
      "INSERT INTO app_devices (device_id, app_id, platform, token, apns_environment, updated_at) VALUES (?, ?, ?, ?, ?, 1)",
    )
    .bind(deviceId, appId, platform, `tok-${deviceId}-${appId}`, env)
    .run();
const appDevices = async () =>
  (
    await d1.db
      .prepare("SELECT device_id, app_id FROM app_devices ORDER BY device_id, app_id")
      .all()
  ).results.map((r) => `${r.device_id}/${r.app_id}`);
const handle = () => grantOgs(d1.db, "sam", "rocket-crew", 10);

describe("deliver to the game's own app", { timeout: 20_000 }, () => {
  it("reaches the profile's phones running this game's app, with the row as stored and the game-push data", async () => {
    await addAppDevice("sam-iphone", "rocket-crew", "ios", "sandbox");
    await addAppDevice("sam-pixel", "rocket-crew", "android", null);
    expect(await deliver(d1.db, await handle(), message, senders)).toBe("sent");
    const native = sent.filter((s) => s.to.startsWith("native:"));
    expect(native.map((s) => s.to).sort()).toEqual(["native:sam-iphone", "native:sam-pixel"]);
    expect(native.every((s) => s.appId === "rocket-crew")).toBe(true);
    expect(native.find((s) => s.to === "native:sam-iphone")?.device).toEqual({
      device_id: "sam-iphone",
      platform: "ios",
      token: "tok-sam-iphone-rocket-crew",
      apns_environment: "sandbox",
    });
    expect(native[0]?.n).toEqual({
      title: "Launch window",
      body: "Your crew is waiting.",
      data: {
        type: "game-push",
        appId: "rocket-crew",
        url: "https://rocketcrew.tv/room/1",
        whenOpen: "banner",
      },
    });
  });

  it("never a tablet, another game's app, or another profile's phone", async () => {
    await addAppDevice("sam-ipad", "rocket-crew", "ios", "production");
    await addAppDevice("sam-iphone", "codebreakers", "ios", "production");
    await addAppDevice("kim-iphone", "rocket-crew", "ios", "production");
    await deliver(d1.db, await handle(), message, senders);
    expect(sent.filter((s) => s.to.startsWith("native:"))).toEqual([]);
  });

  it("a device the app's push service says is gone is forgotten for this game only", async () => {
    await addAppDevice("sam-iphone", "rocket-crew", "ios", "production");
    await addAppDevice("sam-iphone", "codebreakers", "ios", "production");
    await addAppDevice("sam-pixel", "rocket-crew", "android", null);
    nativeResults["sam-iphone"] = { success: false, deviceActive: false, error: "Unregistered" };
    await deliver(d1.db, await handle(), message, senders);
    expect(await appDevices()).toEqual(["sam-iphone/codebreakers", "sam-pixel/rocket-crew"]);
  });

  it("a refusal that keeps the device keeps its row, and the result is failed", async () => {
    await addAppDevice("sam-iphone", "rocket-crew", "ios", "production");
    nativeResults["sam-iphone"] = { success: false, deviceActive: true, error: "TooManyRequests" };
    expect(await deliver(d1.db, await handle(), message, senders)).toBe("failed");
    expect(await appDevices()).toEqual(["sam-iphone/rocket-crew"]);
  });

  it("the only device gone is gone", async () => {
    await addAppDevice("sam-iphone", "rocket-crew", "ios", "production");
    nativeResults["sam-iphone"] = { success: false, deviceActive: false, error: "Unregistered" };
    expect(await deliver(d1.db, await handle(), message, senders)).toBe("gone");
  });

  it("the game's app taking it is sent even when the OGS app fails", async () => {
    await d1.db
      .prepare(
        "INSERT INTO devices (ogs_device_id, platform, push_token) VALUES ('sam-pixel', 'android', 'ExponentPushToken[s]')",
      )
      .run();
    await addAppDevice("sam-iphone", "rocket-crew", "ios", "production");
    expoResult = { success: false, deviceActive: true, error: "x" };
    expect(await deliver(d1.db, await handle(), message, senders)).toBe("sent");
    expect(sent.map((s) => s.to).sort()).toEqual([
      "expo:ExponentPushToken[s]",
      "native:sam-iphone",
    ]);
  });

  it("senders without a native sender don't reach the game's app", async () => {
    await addAppDevice("sam-iphone", "rocket-crew", "ios", "production");
    const { native: _native, ...ogsOnly } = senders;
    expect(await deliver(d1.db, await handle(), message, ogsOnly)).toBe("gone");
    expect(sent).toEqual([]);
    expect(await appDevices()).toEqual(["sam-iphone/rocket-crew"]);
  });
});
