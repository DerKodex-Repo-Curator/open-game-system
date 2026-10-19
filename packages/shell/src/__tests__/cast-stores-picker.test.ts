import GoogleCast from "react-native-google-cast";
import { z } from "zod";
import { fakeFetch } from "../__fixtures__/fake-fetch";
import { fakeStorage } from "../__fixtures__/fake-storage";
import { castGameStores } from "../cast-stores";
import { createFakeCastBackend, FAKE_TV } from "../fake-cast";
import { createShellRuntime } from "../shell-runtime";

jest.mock("react-native-google-cast", () => ({
  __esModule: true,
  default: { showCastDialog: jest.fn() },
}));

// Acceptance: 2026-10-18-shell-device-gaps.feature, "In the shell, the TV is always a target".
const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!check()) throw new Error("timed out");
};

function memory() {
  const data: Record<string, string> = {};
  return {
    getItem: async (k: string) => data[k] ?? null,
    setItem: async (k: string, v: string) => {
      data[k] = v;
    },
  };
}

function setup(mode: "one" | "none") {
  const net = fakeFetch({
    "POST /api/v1/profiles": () => ({
      status: 201,
      body: {
        profile: { id: "g", handle: "player", name: "Player", sticker: "owl" },
        token: "guest-token",
      },
    }),
    "POST /api/v1/sessions": () => ({
      status: 201,
      body: { sessionId: "s", token: "launcher-token" },
    }),
    "POST /api/v1/screens/claim": () => ({
      status: 200,
      body: { screenId: "sc1", name: "Browser TV" },
    }),
    "POST /api/v1/screens/sc1/show": () => ({ status: 204 }),
    "POST /load": () => ({ status: 200, body: {} }),
  });
  const backend = createFakeCastBackend({
    mode,
    loadUrl: "https://fake-cast.test/load",
    fetch: net.fetch,
  });
  const runtime = createShellRuntime(
    {
      appId: "rocket-crew",
      gameUrl: "https://play.rocketcrew.tv/phone",
      name: "Rocket Crew",
      apiBase: "https://api.test",
      tvBase: "https://tv.test/",
      linkDomains: [],
    },
    {
      fetch: net.fetch,
      storage: fakeStorage().storage,
      device: async () => ({ deviceId: "d", kind: "phone", name: "iPhone" }),
      notifications: {
        getPermissionsAsync: async () => ({ granted: false }),
        requestPermissionsAsync: async () => ({ granted: false }),
        getDevicePushTokenAsync: async () => ({ type: "ios", data: "t" }),
        addPushTokenListener: () => ({ remove: () => {} }),
      },
      platform: "ios",
      apnsEnvironment: async () => "production",
      haptics: { impact: async () => {}, notify: async () => {} },
      signInProviders: [],
      gameStores: castGameStores(backend, {
        streamServerUrl: "https://stream.test",
        browserTvStorage: memory(),
      }),
    },
  );
  const fromGame = (event: object) =>
    runtime.bridge.handleWebMessage(JSON.stringify({ type: "EVENT", storeKey: "cast", event }));
  return { runtime, net, fromGame };
}

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("the shell's cast picker (fake Chromecast, fake OGS API)", () => {
  it("with no Chromecast, the game's cast store says available and its button opens the picker", async () => {
    const { runtime, fromGame } = setup("none");
    await runtime.start();
    expect(runtime.bridge.getStore("cast")?.getSnapshot()).toMatchObject({
      isAvailable: true,
      devices: [],
    });
    fromGame({ type: "SHOW_CAST_PICKER" });
    expect(runtime.castPicker.getSnapshot()).toEqual({
      visible: true,
      devices: [],
      browserTv: { open: false, address: "tv.test", pairing: false, error: null },
    });
    expect(GoogleCast.showCastDialog).not.toHaveBeenCalled();
  });

  it("picking a Chromecast casts the launcher with chrome=none", async () => {
    const { runtime, net, fromGame } = setup("one");
    await runtime.start();
    await until(() => runtime.castPicker.getSnapshot().devices.length > 0);
    fromGame({ type: "SHOW_CAST_PICKER" });
    expect(runtime.castPicker.getSnapshot().devices).toEqual([FAKE_TV]);
    runtime.castPicker.pick(FAKE_TV.id);
    expect(runtime.castPicker.getSnapshot().visible).toBe(false);
    await until(() => net.calls.some((c) => c.url === "https://fake-cast.test/load"));
    expect(net.calls.find((c) => c.url === "https://fake-cast.test/load")?.body).toEqual({
      viewUrl:
        "https://tv.test/?api=https%3A%2F%2Fapi.test&token=launcher-token&chrome=none&app=rocket-crew",
    });
  });

  it("a browser TV pairs by its code and is cast to, with the app", async () => {
    const { runtime, net, fromGame } = setup("none");
    await runtime.start();
    fromGame({ type: "SHOW_CAST_PICKER" });
    runtime.castPicker.openBrowserTv();
    await runtime.castPicker.pairBrowserTv("kqtp7x");
    expect(net.calls.find((c) => c.url.endsWith("/screens/claim"))).toMatchObject({
      body: { code: "KQTP7X" },
      headers: { Authorization: "Bearer guest-token" },
    });
    await until(() => net.calls.some((c) => c.url.endsWith("/screens/sc1/show")));
    expect(net.calls.find((c) => c.url.endsWith("/screens/sc1/show"))?.body).toEqual({
      token: "launcher-token",
      app: "rocket-crew",
    });
    const Connected = z.object({ session: z.object({ status: z.literal("connected") }) });
    await until(() => Connected.safeParse(runtime.bridge.getStore("cast")?.getSnapshot()).success);
    expect(runtime.bridge.getStore("cast")?.getSnapshot()).toMatchObject({
      devices: [{ id: "screen:sc1", name: "Browser TV", type: "browser" }],
      session: { deviceId: "screen:sc1" },
    });
    expect(runtime.castPicker.getSnapshot().visible).toBe(false);
  });
});
