import { type FakeAnswer, fakeFetch } from "../__fixtures__/fake-fetch";
import { createShellRequest } from "../api-client";
import type { ShellIdentity } from "../identity";
import {
  apnsEnvironmentFromEntitlement,
  createNativePush,
  type NativePushDeps,
  type PushNotificationsModule,
} from "../native-push";

const identity: ShellIdentity = {
  profile: { id: "p-1", handle: "player", name: "Player", sticker: "owl" },
  deviceId: "dev-1",
  deviceToken: "device-token",
  login: "guest",
};

function fakeNotifications(opts: { granted?: boolean; grantOnAsk?: boolean; token?: string } = {}) {
  let granted = opts.granted ?? false;
  let token = opts.token ?? "apns-hex-1";
  const tokenListeners = new Set<(t: { type: "ios" | "android"; data: string }) => void>();
  const asks: number[] = [];
  const mod: PushNotificationsModule = {
    getPermissionsAsync: async () => ({ granted }),
    requestPermissionsAsync: async () => {
      asks.push(1);
      granted = opts.grantOnAsk ?? true;
      return { granted };
    },
    getDevicePushTokenAsync: async () => ({ type: "ios", data: token }),
    addPushTokenListener: (l) => {
      tokenListeners.add(l);
      return { remove: () => tokenListeners.delete(l) };
    },
  };
  return {
    mod,
    asks,
    rotate(next: string) {
      token = next;
      for (const l of tokenListeners) l({ type: "ios", data: next });
    },
    listenerCount: () => tokenListeners.size,
  };
}

function setup(
  over: Partial<NativePushDeps> & { answer?: () => FakeAnswer } = {},
  notif = fakeNotifications(),
) {
  const { fetch, calls } = fakeFetch({
    "PUT /api/v1/apps/rocket-crew/devices/dev-1": over.answer ?? (() => ({ status: 204 })),
  });
  const push = createNativePush({
    appId: "rocket-crew",
    request: createShellRequest({ baseUrl: "https://api.test", fetch }),
    notifications: notif.mod,
    platform: "ios",
    apnsEnvironment: async () => "sandbox",
    identity: async () => identity,
    ...over,
  });
  return { push, calls, notif };
}

describe("apnsEnvironmentFromEntitlement", () => {
  it("is sandbox only for a development-signed build", () => {
    expect(apnsEnvironmentFromEntitlement("development")).toBe("sandbox");
    expect(apnsEnvironmentFromEntitlement("production")).toBe("production");
    // TestFlight / App Store builds carry no embedded provisioning profile: expo-application says null.
    expect(apnsEnvironmentFromEntitlement(null)).toBe("production");
  });
});

describe("native push registration (single-game apps)", () => {
  it("asks permission when the game asks, then registers the native token with OGS", async () => {
    const { push, calls, notif } = setup();
    await expect(push.register({ ask: true })).resolves.toBe("registered");
    expect(notif.asks).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "PUT",
      url: "https://api.test/api/v1/apps/rocket-crew/devices/dev-1",
      headers: { Authorization: "Bearer device-token" },
      body: { platform: "ios", token: "apns-hex-1", apnsEnvironment: "sandbox" },
    });
  });

  it("never asks on its own: without permission and without ask it does nothing", async () => {
    const { push, calls, notif } = setup();
    await expect(push.register({ ask: false })).resolves.toBe("not-permitted");
    expect(notif.asks).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("is denied when the person says no", async () => {
    const { push, calls } = setup({}, fakeNotifications({ grantOnAsk: false }));
    await expect(push.register({ ask: true })).resolves.toBe("not-permitted");
    expect(calls).toHaveLength(0);
  });

  it("doesn't ask again when permission is already granted", async () => {
    const notif = fakeNotifications({ granted: true });
    const { push, calls } = setup({}, notif);
    await push.register({ ask: true });
    expect(notif.asks).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it("sends production from a store build and no apnsEnvironment on Android", async () => {
    const prod = setup(
      { apnsEnvironment: async () => "production" },
      fakeNotifications({ granted: true }),
    );
    await prod.push.register({ ask: false });
    expect(prod.calls[0]?.body).toEqual({
      platform: "ios",
      token: "apns-hex-1",
      apnsEnvironment: "production",
    });
    const android = setup({ platform: "android" }, fakeNotifications({ granted: true }));
    await android.push.register({ ask: false });
    expect(android.calls[0]?.body).toEqual({ platform: "android", token: "apns-hex-1" });
  });

  it("has nothing to register with before the device has a profile", async () => {
    const { push, calls } = setup(
      { identity: async () => null },
      fakeNotifications({ granted: true }),
    );
    await expect(push.register({ ask: false })).resolves.toBe("no-profile");
    expect(calls).toHaveLength(0);
  });

  it("reports a failed registration (offline) and lets the next call try again", async () => {
    let offline = true;
    const { push, calls } = setup(
      { answer: () => (offline ? new TypeError("offline") : { status: 204 }) },
      fakeNotifications({ granted: true }),
    );
    await expect(push.register({ ask: false })).resolves.toBe("failed");
    offline = false;
    await expect(push.register({ ask: false })).resolves.toBe("registered");
    expect(calls).toHaveLength(2);
  });

  it("doesn't repeat an identical registration", async () => {
    const { push, calls } = setup({}, fakeNotifications({ granted: true }));
    await push.register({ ask: false });
    await push.register({ ask: false });
    expect(calls).toHaveLength(1);
  });

  it("registers again when the device token changes (sign-in swapped the identity)", async () => {
    let current = identity;
    const { push, calls } = setup(
      { identity: async () => current },
      fakeNotifications({ granted: true }),
    );
    await push.register({ ask: false });
    current = { ...identity, deviceToken: "signed-in-token", login: "apple" };
    await push.register({ ask: false });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers.Authorization).toBe("Bearer signed-in-token");
  });

  it("re-registers when the OS rotates the push token, once started", async () => {
    const notif = fakeNotifications({ granted: true });
    const { push, calls } = setup({}, notif);
    const stop = push.start();
    await push.register({ ask: false });
    notif.rotate("apns-hex-2");
    await push.idle();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toMatchObject({ token: "apns-hex-2" });
    stop();
    expect(notif.listenerCount()).toBe(0);
  });

  it("ignores a rotated token while push isn't permitted", async () => {
    const notif = fakeNotifications({ granted: false });
    const { push, calls } = setup({}, notif);
    push.start();
    notif.rotate("apns-hex-2");
    await push.idle();
    expect(calls).toHaveLength(0);
  });
});
