import { fakeFetch } from "../__fixtures__/fake-fetch";
import { fakeStorage } from "../__fixtures__/fake-storage";
import { ogsGameStores } from "../game-stores";
import { createShellRuntime } from "../shell-runtime";

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!check()) throw new Error("timed out");
};
const grant = (token: string, handle: string) => ({
  status: 200,
  body: {
    token,
    expiresAt: Date.now() + 3_600_000,
    profile: { id: "g", handle, name: "Player", avatar: "https://art.test/owl.webp" },
  },
});

function setup(opts: { osGrants?: boolean; playerSays?: boolean } = {}) {
  let tokenCalls = 0;
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
    "POST /api/v1/games/rocket-crew/token": () => {
      tokenCalls += 1;
      return tokenCalls === 1 ? grant("game-1", "player") : grant("game-2", "jon");
    },
    "GET /api/v1/me/push-grants": () => ({ status: 200, body: { games: [] } }),
    "POST /api/v1/games/rocket-crew/push-handles": () => ({
      status: 200,
      body: { status: "granted", handle: "ph_abcdefghijklmnop" },
    }),
    "PUT /api/v1/apps/rocket-crew/devices/d": () => ({ status: 204 }),
    "POST /api/v1/me/instances": () => ({ status: 201, body: {} }),
  });
  let granted = false;
  const askPlayer = jest.fn(async () => opts.playerSays ?? true);
  const runtime = createShellRuntime(
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
        getPermissionsAsync: async () => ({ granted }),
        requestPermissionsAsync: async () => {
          granted = opts.osGrants ?? true;
          return { granted };
        },
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
      gameStores: ogsGameStores({ askPlayer }),
    },
  );
  return { runtime, net, askPlayer };
}

const send = (
  runtime: ReturnType<typeof setup>["runtime"],
  storeKey: string,
  event: Record<string, unknown>,
) => runtime.bridge.handleWebMessage(JSON.stringify({ type: "EVENT", storeKey, event }));

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("ogsGameStores: the game's profile, notifications and ogs stores in a single-game app", () => {
  it("gives the page a game token for this game once the guest exists", async () => {
    const { runtime, net } = setup();
    const profile = runtime.bridge.getStore("profile");
    expect(profile?.getSnapshot()).toEqual({ status: "none" });
    await runtime.start();
    await until(() => JSON.stringify(profile?.getSnapshot()).includes("ready"));
    expect(profile?.getSnapshot()).toMatchObject({
      status: "ready",
      profile: { handle: "player", token: "game-1" },
    });
    const ask = net.calls.find((c) => c.url.endsWith("/api/v1/games/rocket-crew/token"));
    expect(ask?.headers.Authorization).toBe("Bearer guest-token");
  });

  it("asks again with the new device token after sign-in", async () => {
    const { runtime, net } = setup();
    await runtime.start();
    const profile = runtime.bridge.getStore("profile");
    await until(() => JSON.stringify(profile?.getSnapshot()).includes("game-1"));
    await runtime.openSignIn();
    await runtime.signInWith("apple");
    await until(() => JSON.stringify(profile?.getSnapshot()).includes("game-2"));
    const asks = net.calls.filter((c) => c.url.endsWith("/token"));
    expect(asks.at(-1)?.headers.Authorization).toBe("Bearer apple-token");
  });

  it("push REQUEST: the shell's prompt, the OS prompt, device registration, then a push handle", async () => {
    const { runtime, net, askPlayer } = setup();
    await runtime.start();
    send(runtime, "notifications", { type: "REQUEST", id: "r1" });
    const store = runtime.bridge.getStore("notifications");
    await until(() => JSON.stringify(store?.getSnapshot()).includes("r1"));
    expect(askPlayer).toHaveBeenCalledWith("Rocket Crew");
    expect(store?.getSnapshot()).toMatchObject({
      answer: { id: "r1", result: { status: "granted", handle: "ph_abcdefghijklmnop" } },
    });
    const order = net.calls.map((c) => `${c.method} ${c.url.replace("https://api.test", "")}`);
    expect(order.indexOf("PUT /api/v1/apps/rocket-crew/devices/d")).toBeLessThan(
      order.indexOf("POST /api/v1/games/rocket-crew/push-handles"),
    );
  });

  it("push REQUEST is denied when the OS says no or the player says not now", async () => {
    const os = setup({ osGrants: false });
    await os.runtime.start();
    send(os.runtime, "notifications", { type: "REQUEST", id: "r1" });
    const s1 = os.runtime.bridge.getStore("notifications");
    await until(() => JSON.stringify(s1?.getSnapshot()).includes("r1"));
    expect(s1?.getSnapshot()).toMatchObject({ answer: { result: { status: "denied" } } });
    const player = setup({ playerSays: false });
    await player.runtime.start();
    send(player.runtime, "notifications", { type: "REQUEST", id: "r2" });
    const s2 = player.runtime.bridge.getStore("notifications");
    await until(() => JSON.stringify(s2?.getSnapshot()).includes("r2"));
    expect(s2?.getSnapshot()).toMatchObject({ answer: { result: { status: "denied" } } });
    expect(player.net.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("files the game's sitting report with OGS (source bridge)", async () => {
    const { runtime, net } = setup();
    await runtime.start();
    send(runtime, "ogs", {
      type: "INSTANCE_REPORT",
      report: { instanceId: "rocket-crew:KQTP", appId: "rocket-crew", status: "active" },
    });
    await until(() => net.calls.some((c) => c.url.endsWith("/api/v1/me/instances")));
    const post = net.calls.find((c) => c.url.endsWith("/api/v1/me/instances"));
    expect(post?.headers.Authorization).toBe("Bearer guest-token");
    expect(post?.body).toMatchObject({ instanceId: "rocket-crew:KQTP", source: "bridge" });
  });
});
