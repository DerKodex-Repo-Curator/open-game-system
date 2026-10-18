import { fakeFetch } from "../__fixtures__/fake-fetch";
import { fakeStorage } from "../__fixtures__/fake-storage";
import { loadIdentity } from "../identity";
import type { PushNotificationsModule } from "../native-push";
import type { NativeSignInProvider } from "../native-sign-in";
import { createShellRuntime, type ShellRuntimeDeps } from "../shell-runtime";

const config = {
  appId: "rocket-crew",
  gameUrl: "https://play.rocketcrew.tv/phone",
  name: "Rocket Crew",
  apiBase: "https://api.test",
  linkDomains: ["rocketcrew.tv"],
};
const guestProfile = { id: "guest-1", handle: "player", name: "Player", sticker: "owl" };
const device = { deviceId: "dev-1", kind: "phone" as const, name: "iPhone" };

function notifications(granted: boolean): PushNotificationsModule {
  let ok = granted;
  return {
    getPermissionsAsync: async () => ({ granted: ok }),
    requestPermissionsAsync: async () => {
      ok = true;
      return { granted: true };
    },
    getDevicePushTokenAsync: async () => ({ type: "ios", data: "apns-1" }),
    addPushTokenListener: () => ({ remove: () => {} }),
  };
}

const apple: NativeSignInProvider = {
  provider: "apple",
  isAvailable: async () => true,
  signIn: async () => ({ status: "ok", identityToken: "apple-jwt", nonce: "n" }),
};
const google: NativeSignInProvider = {
  provider: "google",
  isAvailable: async () => false,
  signIn: async () => ({ status: "cancelled" }),
};

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
  const { storage } = fakeStorage();
  const played: string[] = [];
  const runtime = createShellRuntime(config, {
    fetch: net.fetch,
    storage,
    device: async () => device,
    notifications: notifications(true),
    platform: "ios",
    apnsEnvironment: async () => "production",
    haptics: {
      impact: async (s) => {
        played.push(s);
      },
      notify: async (k) => {
        played.push(k);
      },
    },
    signInProviders: [apple, google],
    ...over,
  });
  return { runtime, calls: net.calls, storage, played };
}

const event = (storeKey: string, e: Record<string, unknown>) =>
  JSON.stringify({ type: "EVENT", storeKey, event: e });

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("createShellRuntime", () => {
  it("starts a guest, tells the page, and registers push when already allowed", async () => {
    const { runtime, calls } = setup();
    await runtime.start();
    expect(runtime.getIdentity()).toMatchObject({ login: "guest", deviceToken: "guest-token" });
    expect(runtime.bridge.getStore("account")?.getSnapshot()).toEqual({
      login: "guest",
      signingIn: false,
    });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://api.test/api/v1/profiles",
      "PUT https://api.test/api/v1/apps/rocket-crew/devices/dev-1",
    ]);
  });

  it("doesn't touch push permission on start when it isn't granted", async () => {
    const { runtime, calls } = setup({ notifications: notifications(false) });
    await runtime.start();
    expect(calls.map((c) => c.method)).toEqual(["POST"]);
  });

  it("runs without a profile when OGS can't be reached", async () => {
    const { runtime } = setup({}, { offline: true });
    await runtime.start();
    expect(runtime.getIdentity()).toBeNull();
    expect(runtime.bridge.getStore("account")?.getSnapshot()).toEqual({
      login: "none",
      signingIn: false,
    });
  });

  it("the page's SIGN_IN opens the sheet with the providers this device offers", async () => {
    const { runtime } = setup();
    await runtime.start();
    expect(runtime.sheet.getSnapshot().visible).toBe(false);
    runtime.bridge.handleWebMessage(event("account", { type: "SIGN_IN" }));
    await runtime.idle();
    expect(runtime.sheet.getSnapshot()).toMatchObject({ visible: true, providers: ["apple"] });
  });

  it("signing in swaps the identity, tells the page and listeners, closes the sheet, re-registers push", async () => {
    const { runtime, calls, storage } = setup();
    await runtime.start();
    const identities: (string | undefined)[] = [];
    runtime.onIdentity((id) => identities.push(id?.deviceToken));
    const pageStates: object[] = [];
    runtime.bridge.getStore("account")?.subscribe((s) => pageStates.push(s));
    await runtime.openSignIn();
    await runtime.signInWith("apple");
    await runtime.idle();
    expect(runtime.getIdentity()).toMatchObject({ login: "apple", deviceToken: "apple-token" });
    await expect(loadIdentity(storage)).resolves.toMatchObject({ deviceToken: "apple-token" });
    expect(identities).toEqual(["apple-token"]);
    expect(runtime.sheet.getSnapshot().visible).toBe(false);
    expect(pageStates.at(-1)).toEqual({ login: "apple", signingIn: false });
    expect(pageStates).toContainEqual({ login: "guest", signingIn: true });
    const auth = calls.find((c) => c.url.endsWith("/auth/native"));
    expect(auth?.headers.Authorization).toBe("Bearer guest-token");
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts.map((c) => c.headers.Authorization)).toEqual([
      "Bearer guest-token",
      "Bearer apple-token",
    ]);
  });

  it("closing the sheet resets it; a signed-in device ignores SIGN_IN", async () => {
    const { runtime } = setup();
    await runtime.start();
    await runtime.openSignIn();
    runtime.closeSignIn();
    expect(runtime.sheet.getSnapshot()).toMatchObject({
      visible: false,
      signIn: { status: "idle" },
    });
    await runtime.openSignIn();
    await runtime.signInWith("apple");
    await runtime.openSignIn();
    expect(runtime.sheet.getSnapshot().visible).toBe(false);
  });

  it("plays haptics from the page", async () => {
    const { runtime, played } = setup();
    runtime.bridge.handleWebMessage(event("haptics", { type: "IMPACT", style: "medium" }));
    runtime.bridge.handleWebMessage(event("haptics", { type: "NOTIFY", kind: "error" }));
    await runtime.idle();
    expect(played).toEqual(["medium", "error"]);
  });

  it("requestPush asks the OS (the game asked) and registers", async () => {
    const { runtime, calls } = setup({ notifications: notifications(false) });
    await runtime.start();
    await expect(runtime.requestPush()).resolves.toBe("registered");
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("adds the game's other stores (cast, profile, notifications…) with the runtime's context", async () => {
    const seen: string[] = [];
    const { runtime } = setup({
      gameStores: (ctx) => {
        ctx.onIdentity((id) => seen.push(id?.deviceToken ?? "none"));
        return {
          ping: {
            getSnapshot: () => ({ n: 1 }),
            subscribe: (l) => {
              l({ n: 1 });
              return () => {};
            },
            dispatch: () => {},
            reset: () => {},
            on: () => () => {},
          },
        };
      },
    });
    expect(runtime.bridge.getStore("ping")?.getSnapshot()).toEqual({ n: 1 });
    await runtime.start();
    expect(seen).toEqual(["guest-token"]);
  });

  it("maps links and cast URLs for this game", () => {
    const { runtime } = setup();
    expect(runtime.webViewUrlFor("https://opengame.org/play/rocket-crew/join/AB?t=1")).toBe(
      "https://play.rocketcrew.tv/join/AB?t=1",
    );
    expect(runtime.webViewUrlFor("https://elsewhere.example/")).toBeNull();
    expect(runtime.castUrl("https://tv.opengame.org/?token=t")).toBe(
      "https://tv.opengame.org/?token=t&chrome=none&app=rocket-crew",
    );
  });
});
