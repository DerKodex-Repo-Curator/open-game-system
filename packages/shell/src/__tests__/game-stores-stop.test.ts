import { fakeFetch } from "../__fixtures__/fake-fetch";
import { fakeStorage } from "../__fixtures__/fake-storage";
import { ogsGameStores } from "../game-stores";
import { createShellRuntime } from "../shell-runtime";

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!check()) throw new Error("timed out");
};

function setup() {
  const net = fakeFetch({
    "POST /api/v1/profiles": () => ({
      status: 201,
      body: {
        profile: { id: "g", handle: "player", name: "Player", sticker: "owl" },
        token: "guest-token",
      },
    }),
    "POST /api/v1/auth/native": () => ({
      status: 200,
      body: {
        profile: { id: "g", handle: "jon", name: "Jon", sticker: "owl" },
        logins: [],
        token: "apple-token",
      },
    }),
    "POST /api/v1/games/rocket-crew/token": () => ({
      status: 200,
      body: {
        token: "game-1",
        expiresAt: Date.now() + 3_600_000,
        profile: { id: "g", handle: "player", name: "Player", avatar: "https://art.test/owl.webp" },
      },
    }),
  });
  return createShellRuntime(
    {
      appId: "rocket-crew",
      gameUrl: "https://play.rocketcrew.tv/",
      name: "Rocket Crew",
      apiBase: "https://api.test",
      linkDomains: [],
    },
    {
      fetch: net.fetch,
      storage: fakeStorage().storage,
      device: async () => ({ deviceId: "d", kind: "phone", name: "iPhone" }),
      notifications: {
        getPermissionsAsync: async () => ({ granted: false }),
        requestPermissionsAsync: async () => ({ granted: false }),
        getDevicePushTokenAsync: async () => ({ type: "ios", data: "apns" }),
        addPushTokenListener: () => ({ remove: () => {} }),
      },
      platform: "ios",
      apnsEnvironment: async () => "production",
      haptics: { impact: async () => {}, notify: async () => {} },
      signInProviders: [
        {
          provider: "apple",
          isAvailable: async () => true,
          signIn: async () => ({ status: "ok", identityToken: "jwt" }),
        },
      ],
      gameStores: ogsGameStores({ askPlayer: async () => true }),
    },
  );
}

const snapshot = (runtime: ReturnType<typeof setup>) =>
  JSON.stringify(runtime.bridge.getStore("profile")?.getSnapshot());

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("the game's profile in a single-game app: guest or signed in, and shutdown", () => {
  it("tells the page the player is a guest, then how they signed in", async () => {
    const runtime = setup();
    await runtime.start();
    await until(() => snapshot(runtime).includes("ready"));
    expect(runtime.bridge.getStore("profile")?.getSnapshot()).toMatchObject({
      status: "ready",
      profile: { handle: "player", login: "guest" },
    });
    await runtime.openSignIn();
    await runtime.signInWith("apple");
    await runtime.idle();
    await until(() => snapshot(runtime).includes('"login":"apple"'));
    runtime.stop();
  });

  it("stop() closes the game's profile (no refresh left running)", async () => {
    const runtime = setup();
    await runtime.start();
    await until(() => snapshot(runtime).includes("ready"));
    runtime.stop();
    expect(runtime.bridge.getStore("profile")?.getSnapshot()).toEqual({ status: "none" });
  });

  it("start() after stop() opens it again (React StrictMode mounts twice)", async () => {
    const runtime = setup();
    await runtime.start();
    runtime.stop();
    await runtime.start();
    await until(() => snapshot(runtime).includes("ready"));
    runtime.stop();
  });
});
