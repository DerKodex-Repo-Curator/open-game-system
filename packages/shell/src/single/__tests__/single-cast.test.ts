import { castCommands, startCastSync } from "../../cast-sync";
import { createFakeCastBackend, FAKE_TV } from "../../fake-cast";
import { fakeFetch } from "../__fixtures__/fake-fetch";
import { createShellRequest } from "../api-client";
import type { ShellIdentity } from "../identity";
import { createSingleGameCastStore } from "../single-cast";

jest.mock("react-native-google-cast", () => ({
  __esModule: true,
  default: { showCastDialog: jest.fn() },
}));

const identity: ShellIdentity = {
  profile: { id: "p", handle: "player", name: "Player", sticker: "owl" },
  deviceId: "d",
  deviceToken: "device-token",
  login: "guest",
};
const sessionCreated = {
  sessionId: "s-1",
  code: "KQTP",
  tvName: "Living room TV",
  host: identity.profile,
  token: "launcher-token",
};

function setup(opts: { identity?: ShellIdentity | null } = {}) {
  const net = fakeFetch({
    "POST /api/v1/sessions": () => ({ status: 201, body: sessionCreated }),
    "POST /load": () => ({ status: 200, body: {} }),
  });
  const commands = castCommands(() => {});
  const store = createSingleGameCastStore({
    appId: "rocket-crew",
    apiBase: "https://api.test",
    tvBase: "https://tv.test",
    request: createShellRequest({ baseUrl: "https://api.test", fetch: net.fetch }),
    getIdentity: () => (opts.identity === undefined ? identity : opts.identity),
    commands,
  });
  return { store, net, commands };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!check()) throw new Error("timed out");
};

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("single-game cast (chrome=none)", () => {
  it("casting from the game's button puts the launcher, chrome none, on the TV (fake Chromecast)", async () => {
    const { store, net, commands } = setup();
    const backend = createFakeCastBackend({
      mode: "one",
      loadUrl: "https://fake-cast.test/load",
      fetch: net.fetch,
    });
    backend.subscribeDevices((devices) => store.dispatch({ type: "DEVICES_UPDATED", devices }));
    backend.startDiscovery();
    await until(() => store.getSnapshot().devices.length > 0);
    const stop = startCastSync(store, backend.sessionManager, commands, "https://stream.test");

    store.dispatch({ type: "START_CASTING", deviceId: FAKE_TV.id });

    await until(() => net.calls.some((c) => c.url === "https://fake-cast.test/load"));
    const session = net.calls.find((c) => c.url === "https://api.test/api/v1/sessions");
    expect(session?.headers.Authorization).toBe("Bearer device-token");
    expect(session?.body).toEqual({ tvName: "TV" });
    const load = net.calls.find((c) => c.url === "https://fake-cast.test/load");
    expect(load?.body).toEqual({
      viewUrl:
        "https://tv.test/?api=https%3A%2F%2Fapi.test&token=launcher-token&chrome=none&app=rocket-crew",
    });
    await until(() => store.getSnapshot().session.status === "connected");
    stop();
  });

  it("asks for one launcher token however often the game casts", async () => {
    const { store, net } = setup();
    store.dispatch({ type: "SHOW_CAST_PICKER" });
    store.dispatch({ type: "SHOW_CAST_PICKER" });
    await until(() => store.getSnapshot().viewUrl !== null);
    store.dispatch({ type: "SHOW_CAST_PICKER" });
    await new Promise((r) => setTimeout(r, 10));
    expect(net.calls.filter((c) => c.url.endsWith("/api/v1/sessions"))).toHaveLength(1);
  });

  it("keeps the launcher view: the game's own SET_VIEW_URL doesn't replace it", async () => {
    const { store } = setup();
    store.dispatch({ type: "SHOW_CAST_PICKER" });
    await until(() => store.getSnapshot().viewUrl !== null);
    const launcher = store.getSnapshot().viewUrl;
    store.dispatch({ type: "SET_VIEW_URL", url: "https://play.rocketcrew.tv/tv/ROOM" });
    expect(store.getSnapshot().viewUrl).toBe(launcher);
  });

  it("still opens the picker without a profile (no launcher token, nothing to show yet)", async () => {
    const { store, net } = setup({ identity: null });
    store.dispatch({ type: "SHOW_CAST_PICKER" });
    await new Promise((r) => setTimeout(r, 10));
    expect(net.calls).toHaveLength(0);
    expect(store.getSnapshot().viewUrl).toBeNull();
  });

  it("passes native lifecycle events through", () => {
    const { store } = setup();
    store.dispatch({ type: "SESSION_STARTING" });
    expect(store.getSnapshot().session.status).toBe("connecting");
    store.dispatch({ type: "SESSION_ENDED" });
    expect(store.getSnapshot().session.status).toBe("disconnected");
  });
});
