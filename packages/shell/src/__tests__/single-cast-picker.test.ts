import GoogleCast from "react-native-google-cast";
import { fakeFetch } from "../__fixtures__/fake-fetch";
import { createShellRequest } from "../api-client";
import type { ShellIdentity } from "../shell-identity";
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

function setup(showPicker?: () => void) {
  let answer: (() => void) | null = null;
  const net = fakeFetch({
    "POST /api/v1/sessions": () =>
      new Promise((resolve) => {
        answer = () => resolve({ status: 201, body: { sessionId: "s", token: "launcher-token" } });
      }),
  });
  const store = createSingleGameCastStore({
    appId: "rocket-crew",
    apiBase: "https://api.test",
    tvBase: "https://tv.test",
    request: createShellRequest({ baseUrl: "https://api.test", fetch: net.fetch }),
    getIdentity: () => identity,
    ...(showPicker ? { showPicker } : {}),
  });
  return { store, net, answer: () => answer?.() };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!check()) throw new Error("timed out");
};

afterEach(() => jest.clearAllMocks());

describe("single-game cast store: the TV is always a target", () => {
  it("says casting is available with no Chromecast found", () => {
    const { store } = setup(jest.fn());
    expect(store.getSnapshot().isAvailable).toBe(true);
    store.dispatch({ type: "DEVICES_UPDATED", devices: [] });
    expect(store.getSnapshot().isAvailable).toBe(true);
  });

  it("is available even without a picker of its own", () => {
    expect(setup().store.getSnapshot().isAvailable).toBe(true);
  });

  it("SHOW_CAST_PICKER opens the shell's picker at once and readies the launcher meanwhile", async () => {
    const showPicker = jest.fn();
    const { store, net, answer } = setup(showPicker);
    store.dispatch({ type: "SHOW_CAST_PICKER" });
    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(GoogleCast.showCastDialog).not.toHaveBeenCalled();
    await until(() => net.calls.length === 1);
    answer();
    await until(() => store.getSnapshot().viewUrl !== null);
    expect(store.getSnapshot().viewUrl).toBe(
      "https://tv.test/?api=https%3A%2F%2Fapi.test&token=launcher-token&chrome=none&app=rocket-crew",
    );
  });
});
