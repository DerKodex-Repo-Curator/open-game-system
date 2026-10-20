import { fakeFetch } from "../__fixtures__/fake-fetch";
import { createShellRequest } from "../api-client";
import { createNativePush, type PushNotificationsModule } from "../native-push";
import type { ShellIdentity } from "../shell-identity";

const identity: ShellIdentity = {
  profile: { id: "p-1", handle: "player", name: "Player", sticker: "owl" },
  deviceId: "dev-1",
  deviceToken: "device-token",
  login: "guest",
};

function setup(opts: { tokenData?: unknown; slow?: Promise<void> } = {}) {
  const net = fakeFetch({
    "PUT /api/v1/apps/rocket-crew/devices/dev-1": async () => {
      await opts.slow;
      return { status: 204 };
    },
  });
  let rotate: (t: { type: string; data: unknown }) => void = () => {};
  const notifications: PushNotificationsModule = {
    getPermissionsAsync: async () => ({ granted: true }),
    requestPermissionsAsync: async () => ({ granted: true }),
    getDevicePushTokenAsync: async () => ({
      type: "ios",
      data: "tokenData" in opts ? opts.tokenData : "apns-1",
    }),
    addPushTokenListener: (l) => {
      rotate = l;
      return { remove: () => {} };
    },
  };
  const push = createNativePush({
    appId: "rocket-crew",
    request: createShellRequest({ baseUrl: "https://api.test", fetch: net.fetch }),
    notifications,
    platform: "ios",
    apnsEnvironment: async () => "production",
    identity: async () => identity,
  });
  return { push, net, rotate: (t: { type: string; data: unknown }) => rotate(t) };
}

describe("native push, edges", () => {
  it("an identical registration again is still registered (sent once)", async () => {
    const { push, net } = setup();
    expect(await push.register({ ask: false })).toBe("registered");
    expect(await push.register({ ask: false })).toBe("registered");
    expect(net.calls).toHaveLength(1);
  });

  it("a device token the OS gives in a form OGS can't take fails, and nothing is sent", async () => {
    const { push, net } = setup({ tokenData: { bytes: [1, 2] } });
    expect(await push.register({ ask: true })).toBe("failed");
    expect(net.calls).toEqual([]);
  });

  it("a rotated token that isn't a string is ignored", async () => {
    const { push, net, rotate } = setup();
    push.start();
    rotate({ type: "ios", data: 42 });
    await push.idle();
    expect(net.calls).toEqual([]);
  });

  it("logs a failed registration as one", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const net = fakeFetch({});
    const push = createNativePush({
      appId: "rocket-crew",
      request: createShellRequest({ baseUrl: "https://api.test", fetch: net.fetch }),
      notifications: {
        getPermissionsAsync: async () => ({ granted: true }),
        requestPermissionsAsync: async () => ({ granted: true }),
        getDevicePushTokenAsync: async () => ({ type: "ios", data: "apns-1" }),
        addPushTokenListener: () => ({ remove: () => {} }),
      },
      platform: "ios",
      apnsEnvironment: async () => "production",
      identity: async () => identity,
    });
    expect(await push.register({ ask: false })).toBe("failed");
    expect(warn).toHaveBeenCalledWith(
      "[ogs-shell] could not register for push:",
      expect.anything(),
    );
    warn.mockRestore();
  });

  it("idle waits for a registration under way", async () => {
    let release: () => void = () => {};
    const slow = new Promise<void>((r) => {
      release = r;
    });
    const { push, net } = setup({ slow });
    void push.register({ ask: false });
    let idle = false;
    void push.idle().then(() => {
      idle = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(net.calls).toHaveLength(1);
    expect(idle).toBe(false);
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(idle).toBe(true);
  });
});
