import GoogleCast from "react-native-google-cast";
import { fakeFetch } from "../__fixtures__/fake-fetch";
import { createShellRequest } from "../api-client";
import type { CastCommands } from "../cast-store";
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
const created = { sessionId: "s-1", token: "launcher-token" };

function deferred() {
  let release: () => void = () => {};
  const done = new Promise<void>((r) => {
    release = r;
  });
  return { done, release };
}

function setup(
  opts: {
    identity?: ShellIdentity | null;
    showPicker?: () => void;
    tvBase?: string;
    answers?: (() => Promise<{ status: number; body?: unknown } | Error>)[];
  } = {},
) {
  const answers = opts.answers ?? [];
  const net = fakeFetch({
    "POST /api/v1/sessions": async () => {
      const next = answers.shift();
      return next ? next() : { status: 201, body: created };
    },
  });
  const started: string[] = [];
  const commands: CastCommands = {
    startCasting: (deviceId) => started.push(deviceId),
    stopCasting: () => {},
  };
  const store = createSingleGameCastStore({
    appId: "rocket-crew",
    apiBase: "https://api.test",
    tvBase: opts.tvBase ?? "https://tv.test",
    request: createShellRequest({ baseUrl: "https://api.test", fetch: net.fetch }),
    getIdentity: () => (opts.identity === undefined ? identity : opts.identity),
    commands,
    ...(opts.showPicker ? { showPicker: opts.showPicker } : {}),
  });
  return { store, net, started };
}

const flush = () => new Promise((r) => setTimeout(r, 10));
let warn: jest.SpyInstance;

beforeEach(() => {
  jest.mocked(GoogleCast.showCastDialog).mockClear();
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("single-game cast store, edges", () => {
  it("without a profile it asks nothing and warns about nothing", async () => {
    const { store } = setup({ identity: null });
    store.dispatch({ type: "SHOW_CAST_PICKER" });
    await flush();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when the launcher token can't be had, and tries again on the next cast", async () => {
    const { store, net } = setup({ answers: [async () => new TypeError("offline")] });
    store.dispatch({ type: "SHOW_CAST_PICKER" });
    await flush();
    expect(warn).toHaveBeenCalledWith(
      "[ogs-shell] no launcher token for the cast:",
      expect.anything(),
    );
    expect(store.getSnapshot().viewUrl).toBeNull();
    store.dispatch({ type: "SHOW_CAST_PICKER" });
    await flush();
    expect(net.calls.filter((c) => c.url.endsWith("/api/v1/sessions"))).toHaveLength(2);
    expect(store.getSnapshot().viewUrl).toContain("token=launcher-token");
  });

  it("drops every trailing slash of the TV base", async () => {
    const { store } = setup({ tvBase: "https://tv.test//" });
    store.dispatch({ type: "SHOW_CAST_PICKER" });
    await flush();
    expect(store.getSnapshot().viewUrl).toMatch(/^https:\/\/tv\.test\/\?api=/);
  });

  it("without the shell's picker, Google Cast's dialog waits for the launcher", async () => {
    const gate = deferred();
    const { store } = setup({
      answers: [
        async () => {
          await gate.done;
          return { status: 201, body: created };
        },
      ],
    });
    store.dispatch({ type: "SHOW_CAST_PICKER" });
    await flush();
    expect(GoogleCast.showCastDialog).not.toHaveBeenCalled();
    gate.release();
    await flush();
    expect(GoogleCast.showCastDialog).toHaveBeenCalledTimes(1);
  });

  it("with the shell's picker, a TV picked still waits for the launcher", async () => {
    const gate = deferred();
    const showPicker = jest.fn();
    const { store, started } = setup({
      showPicker,
      answers: [
        async () => {
          await gate.done;
          return { status: 201, body: created };
        },
      ],
    });
    store.dispatch({ type: "START_CASTING", deviceId: "tv-1" });
    await flush();
    expect(started).toEqual([]);
    expect(showPicker).not.toHaveBeenCalled();
    gate.release();
    await flush();
    expect(started).toEqual(["tv-1"]);
  });

  it("passes reset and on() through to the cast store", () => {
    const showPicker = jest.fn();
    const { store } = setup({ showPicker });
    const heard: string[] = [];
    store.on("SHOW_CAST_PICKER", (e) => {
      heard.push(e.type);
    });
    store.dispatch({ type: "SESSION_STARTING" });
    expect(store.getSnapshot().session.status).toBe("connecting");
    store.reset();
    expect(store.getSnapshot().session.status).toBe("disconnected");
    store.dispatch({ type: "SHOW_CAST_PICKER" });
    expect(heard).toEqual(["SHOW_CAST_PICKER"]);
  });
});
