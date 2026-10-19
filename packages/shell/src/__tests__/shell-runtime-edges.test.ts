import { fakeFetch } from "../__fixtures__/fake-fetch";
import { fakeStorage } from "../__fixtures__/fake-storage";
import type { ShellDevice } from "../guest-profile";
import type { PushNotificationsModule } from "../native-push";
import type { NativeSignInProvider } from "../native-sign-in";
import { createShellRuntime, type ShellRuntimeDeps } from "../shell-runtime";

const config = {
  appId: "rocket-crew",
  gameUrl: "https://play.rocketcrew.tv/phone",
  name: "Rocket Crew",
  apiBase: "https://api.test",
  linkDomains: [],
};
const guestProfile = { id: "guest-1", handle: "player", name: "Player", sticker: "owl" };
const device: ShellDevice = { deviceId: "dev-1", kind: "phone", name: "iPhone" };

function push(granted: boolean) {
  let rotate: (t: { type: string; data: unknown }) => void = () => {};
  const asks: number[] = [];
  const mod: PushNotificationsModule = {
    getPermissionsAsync: async () => ({ granted }),
    requestPermissionsAsync: async () => {
      asks.push(1);
      return { granted };
    },
    getDevicePushTokenAsync: async () => ({ type: "ios", data: "apns-1" }),
    addPushTokenListener: (l) => {
      rotate = l;
      return { remove: () => {} };
    },
  };
  return { mod, asks, rotate: (data: string) => rotate({ type: "ios", data }) };
}

const apple = (signIn: NativeSignInProvider["signIn"]): NativeSignInProvider => ({
  provider: "apple",
  isAvailable: async () => true,
  signIn,
});

function setup(over: Partial<ShellRuntimeDeps> = {}, opts: { offline?: boolean } = {}) {
  const net = fakeFetch({
    "POST /api/v1/profiles": () =>
      opts.offline
        ? new TypeError("offline")
        : { status: 201, body: { profile: guestProfile, token: "guest-token" } },
    "POST /api/v1/auth/native": () => ({
      status: 200,
      body: { profile: { ...guestProfile, handle: "jon" }, logins: [], token: "apple-token" },
    }),
    "PUT /api/v1/apps/rocket-crew/devices/dev-1": () => ({ status: 204 }),
  });
  const runtime = createShellRuntime(config, {
    fetch: net.fetch,
    storage: fakeStorage().storage,
    device: async () => device,
    notifications: push(true).mod,
    platform: "ios",
    apnsEnvironment: async () => "production",
    haptics: { impact: async () => {}, notify: async () => {} },
    signInProviders: [apple(async () => ({ status: "ok", identityToken: "jwt" }))],
    ...over,
  });
  return { runtime, calls: net.calls };
}

const flush = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("createShellRuntime, edges", () => {
  it("the sign-in sheet starts hidden, offering nothing", () => {
    const { runtime } = setup();
    expect(runtime.sheet.getSnapshot()).toEqual({
      visible: false,
      providers: [],
      signIn: { status: "idle" },
    });
  });

  it("openSignIn opens the sheet", async () => {
    const { runtime } = setup();
    await runtime.openSignIn();
    expect(runtime.sheet.getSnapshot()).toMatchObject({ visible: true, providers: ["apple"] });
  });

  it("idle waits for an openSignIn under way", async () => {
    let available: (yes: boolean) => void = () => {};
    const { runtime } = setup({
      signInProviders: [
        {
          provider: "apple",
          isAvailable: () =>
            new Promise((r) => {
              available = r;
            }),
          signIn: async () => ({ status: "cancelled" }),
        },
      ],
    });
    void runtime.openSignIn();
    let idle = false;
    void runtime.idle().then(() => {
      idle = true;
    });
    await flush();
    expect(idle).toBe(false);
    available(true);
    await flush();
    expect(idle).toBe(true);
  });

  it("a cancelled sign-in keeps the sheet open, showing that it was cancelled", async () => {
    const { runtime } = setup({
      signInProviders: [apple(async () => ({ status: "cancelled" }))],
    });
    await runtime.openSignIn();
    await runtime.signInWith("apple");
    expect(runtime.sheet.getSnapshot()).toMatchObject({
      visible: true,
      signIn: { status: "cancelled" },
    });
  });

  it("after sign-in, push is registered only if already allowed (never asks)", async () => {
    const p = push(false);
    const { runtime } = setup({ notifications: p.mod });
    await runtime.start();
    await runtime.openSignIn();
    await runtime.signInWith("apple");
    await runtime.idle();
    expect(p.asks).toEqual([]);
  });

  it("start listens for a rotated push token", async () => {
    const p = push(true);
    const { runtime, calls } = setup({ notifications: p.mod });
    await runtime.start();
    await runtime.idle();
    p.rotate("apns-2");
    await runtime.idle();
    await flush();
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts.map((c) => c.body)).toEqual([
      expect.objectContaining({ token: "apns-1" }),
      expect.objectContaining({ token: "apns-2" }),
    ]);
  });

  it("a start finished after a stop and a new start tells listeners once", async () => {
    const { runtime } = setup();
    const heard: unknown[] = [];
    runtime.onIdentity((id) => heard.push(id?.deviceToken));
    const first = runtime.start();
    runtime.stop();
    const second = runtime.start();
    await Promise.all([first, second]);
    expect(heard).toEqual(["guest-token"]);
  });

  it("offline, start resolves and says why", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime } = setup({}, { offline: true });
    await expect(runtime.start()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[ogs-shell] no OGS profile yet:", expect.anything());
  });

  it("stop before start does nothing", () => {
    const { runtime } = setup();
    expect(() => runtime.stop()).not.toThrow();
  });

  it("an unsubscribed identity or sheet listener hears nothing more", async () => {
    const { runtime } = setup();
    const identities = jest.fn();
    const sheets = jest.fn();
    runtime.onIdentity(identities)();
    runtime.sheet.subscribe(sheets)();
    await runtime.start();
    await runtime.openSignIn();
    expect(identities).not.toHaveBeenCalled();
    expect(sheets).not.toHaveBeenCalled();
  });
});
