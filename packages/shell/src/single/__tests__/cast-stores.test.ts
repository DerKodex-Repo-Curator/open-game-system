import { createFakeCastBackend, FAKE_TV } from "../../fake-cast";
import { fakeFetch } from "../__fixtures__/fake-fetch";
import { fakeStorage } from "../__fixtures__/fake-storage";
import { castGameStores, DEFAULT_TV_BASE } from "../cast-stores";
import { createShellRuntime } from "../shell-runtime";

jest.mock("react-native-google-cast", () => ({
  __esModule: true,
  default: { showCastDialog: jest.fn() },
}));

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!check()) throw new Error("timed out");
};

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("castGameStores in the runtime (fake Chromecast, fake OGS API)", () => {
  it("the game's cast button casts the launcher with chrome=none for this app", async () => {
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
      "POST /load": () => ({ status: 200, body: {} }),
    });
    const backend = createFakeCastBackend({
      mode: "one",
      loadUrl: "https://fake-cast.test/load",
      fetch: net.fetch,
    });
    const runtime = createShellRuntime(
      {
        appId: "rocket-crew",
        gameUrl: "https://play.rocketcrew.tv/phone",
        name: "Rocket Crew",
        apiBase: "https://api.test",
        tvBase: "https://tv.test",
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
        gameStores: castGameStores(backend, { streamServerUrl: "https://stream.test" }),
      },
    );
    await runtime.start();
    const cast = runtime.bridge.getStore("cast");
    await until(() => JSON.stringify(cast?.getSnapshot()).includes(FAKE_TV.id));

    runtime.bridge.handleWebMessage(
      JSON.stringify({
        type: "EVENT",
        storeKey: "cast",
        event: { type: "START_CASTING", deviceId: FAKE_TV.id },
      }),
    );

    await until(() => net.calls.some((c) => c.url === "https://fake-cast.test/load"));
    expect(net.calls.find((c) => c.url === "https://fake-cast.test/load")?.body).toEqual({
      viewUrl:
        "https://tv.test/?api=https%3A%2F%2Fapi.test&token=launcher-token&chrome=none&app=rocket-crew",
    });
    expect(net.calls.find((c) => c.url.endsWith("/api/v1/sessions"))?.headers.Authorization).toBe(
      "Bearer guest-token",
    );
  });

  it("defaults the TV launcher to the production one", () => {
    expect(DEFAULT_TV_BASE).toBe("https://ogs-tv.pages.dev");
  });
});
