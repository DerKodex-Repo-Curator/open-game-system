jest.mock("react-native-google-cast", () => ({
  __esModule: true,
  default: { showCastDialog: jest.fn() },
}));

import GoogleCast from "react-native-google-cast";
import { createCastStore } from "../cast-store";
import { castCommands, startCastSync } from "../cast-sync";

type FakeSession = ReturnType<typeof fakeSession>;

function fakeSessionManager(current: FakeSession | null = null) {
  const h = {
    starting: new Set<() => void>(),
    started: new Set<(s: FakeSession) => void>(),
    startFailed: new Set<(s: FakeSession, e: string) => void>(),
    suspended: new Set<() => void>(),
    resumed: new Set<(s: FakeSession) => void>(),
    ended: new Set<() => void>(),
  };
  const sub = <T>(set: Set<T>, fn: T) => {
    set.add(fn);
    return { remove: () => void set.delete(fn) };
  };
  return {
    emitStarting: () => h.starting.forEach((f) => f()),
    emitStarted: (s: FakeSession) => h.started.forEach((f) => f(s)),
    emitStartFailed: (s: FakeSession, e: string) => h.startFailed.forEach((f) => f(s, e)),
    emitSuspended: () => h.suspended.forEach((f) => f()),
    emitResumed: (s: FakeSession) => h.resumed.forEach((f) => f(s)),
    emitEnded: () => h.ended.forEach((f) => f()),
    listenerCount: () => Object.values(h).reduce((n, set) => n + set.size, 0),
    getCurrentCastSession: jest.fn(async () => current),
    startSession: jest.fn(async (_id: string) => true),
    endCurrentSession: jest.fn(async (_stop?: boolean) => undefined),
    onSessionStarting: (f: () => void) => sub(h.starting, f),
    onSessionStarted: (f: (s: FakeSession) => void) => sub(h.started, f),
    onSessionStartFailed: (f: (s: FakeSession, e: string) => void) => sub(h.startFailed, f),
    onSessionSuspended: (f: () => void) => sub(h.suspended, f),
    onSessionResumed: (f: (s: FakeSession) => void) => sub(h.resumed, f),
    onSessionEnded: (f: () => void) => sub(h.ended, f),
  };
}

function fakeSession(name = "Chromecast HD", id = "cc-1") {
  const sent: unknown[] = [];
  type Message = Record<string, unknown> | string;
  const listeners: ((m: Message) => void)[] = [];
  return {
    sent,
    /** The receiver says something to the phone. */
    receive: (m: Message) => listeners.forEach((l) => void l(m)),
    getCastDevice: async () => ({ deviceId: id, friendlyName: name }),
    addChannel: async () => ({
      sendMessage: async (m: unknown) => void sent.push(m),
      onMessage: (l: (m: Message) => void) => void listeners.push(l),
    }),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const viewUrlOf = (m: unknown) =>
  typeof m === "object" && m !== null && "viewUrl" in m ? m.viewUrl : null;

function setup(current: FakeSession | null = null) {
  const sm = fakeSessionManager(current);
  const commands = castCommands();
  const store = createCastStore(commands);
  const stop = startCastSync(store, sm, commands, "https://stream.example");
  return { sm, store, stop };
}

describe("cast sync: the app mirrors the real Google Cast session", () => {
  it("picks up a session that was already casting when the app (re)opens", async () => {
    const { store } = setup(fakeSession());
    await flush();
    expect(store.getSnapshot().session).toMatchObject({
      status: "connected",
      deviceName: "Chromecast HD",
    });
  });

  it("goes connecting → connected on a new session, named after its device", async () => {
    const { sm, store } = setup();
    sm.emitStarting();
    expect(store.getSnapshot().session.status).toBe("connecting");
    sm.emitStarted(fakeSession());
    await flush();
    expect(store.getSnapshot().session).toMatchObject({
      status: "connected",
      deviceName: "Chromecast HD",
    });
  });

  it("doesn't stay stuck on connecting when the start fails", async () => {
    const { sm, store } = setup();
    sm.emitStarting();
    sm.emitStartFailed(fakeSession(), "timeout");
    expect(store.getSnapshot().session.status).toBe("disconnected");
    expect(store.getSnapshot().error).toBeTruthy();
  });

  it("shows reconnecting while suspended, and connected again on resume", async () => {
    const { sm, store } = setup();
    sm.emitStarted(fakeSession());
    await flush();
    sm.emitSuspended();
    expect(store.getSnapshot().session.status).toBe("connecting");
    sm.emitResumed(fakeSession());
    await flush();
    expect(store.getSnapshot().session.status).toBe("connected");
  });

  it("goes disconnected when the session ends on its own, without asking Cast to stop again", async () => {
    const { sm, store } = setup();
    sm.emitStarted(fakeSession());
    await flush();
    sm.emitEnded();
    expect(store.getSnapshot().session.status).toBe("disconnected");
    expect(sm.endCurrentSession).not.toHaveBeenCalled();
  });

  it("sends the game's TV page when a session starts", async () => {
    const { sm, store } = setup();
    store.dispatch({ type: "SET_VIEW_URL", url: "https://game/tv/AB?stream=1" });
    const session = fakeSession();
    sm.emitStarted(session);
    await flush();
    expect(session.sent).toContainEqual({
      type: "LOAD_VIEW",
      viewUrl: "https://game/tv/AB?stream=1",
      streamServerUrl: "https://stream.example",
    });
  });

  it("stops listening when torn down", () => {
    const { sm, stop } = setup();
    stop();
    expect(sm.listenerCount()).toBe(0);
  });
});

describe("cast sync: the game's buttons drive the real session", () => {
  it("Stop casting ends the Google Cast session (and stops the receiver app)", async () => {
    const { sm, store } = setup();
    sm.emitStarted(fakeSession());
    await flush();
    store.dispatch({ type: "STOP_CASTING" });
    expect(sm.endCurrentSession).toHaveBeenCalledWith(true);
    expect(store.getSnapshot().session.status).toBe("disconnected");
  });

  it("casting to a known device starts a session on that device", () => {
    const { sm, store } = setup();
    store.dispatch({
      type: "DEVICES_UPDATED",
      devices: [{ id: "cc-1", name: "Chromecast HD", type: "chromecast" }],
    });
    store.dispatch({ type: "START_CASTING", deviceId: "cc-1" });
    expect(sm.startSession).toHaveBeenCalledWith("cc-1");
  });

  it("casting without a known device opens the native picker instead", () => {
    const { sm, store } = setup();
    store.dispatch({ type: "START_CASTING", deviceId: "nope" });
    expect(sm.startSession).not.toHaveBeenCalled();
    expect(GoogleCast.showCastDialog).toHaveBeenCalled();
  });
});

describe("cast commands, directly", () => {
  const TV = { id: "cc-1", name: "Chromecast HD", type: "chromecast" as const };

  it("opens the picker for a device it doesn't know, and before it is bound", () => {
    const dialog = jest.fn();
    const sm = fakeSessionManager();
    const commands = castCommands(dialog);
    commands.startCasting("cc-1", [TV]);
    expect(dialog).toHaveBeenCalledTimes(1);
    commands.bind(sm);
    commands.startCasting("other", [TV]);
    expect(dialog).toHaveBeenCalledTimes(2);
    expect(sm.startSession).not.toHaveBeenCalled();
  });

  it("falls back to the picker when the session can't start", async () => {
    const dialog = jest.fn();
    const sm = fakeSessionManager();
    sm.startSession.mockRejectedValueOnce(new Error("no route"));
    const commands = castCommands(dialog);
    commands.bind(sm);
    commands.startCasting("cc-1", [TV]);
    expect(sm.startSession).toHaveBeenCalledWith("cc-1");
    expect(dialog).not.toHaveBeenCalled();
    await flush();
    expect(dialog).toHaveBeenCalledTimes(1);
  });

  it("stop before binding does nothing, and a failed stop is swallowed", async () => {
    const commands = castCommands(jest.fn());
    expect(() => commands.stopCasting()).not.toThrow();
    const sm = fakeSessionManager();
    sm.endCurrentSession.mockRejectedValueOnce(new Error("gone"));
    commands.bind(sm);
    commands.stopCasting();
    await flush();
    expect(sm.endCurrentSession).toHaveBeenCalledWith(true);
  });
});

describe("cast sync: ordering", () => {
  /** A session whose device lookup resolves only when the test says so. */
  function slowSession(name: string) {
    let resolve: (d: { deviceId: string; friendlyName: string }) => void = () => {};
    const s = fakeSession(name, name);
    return {
      ...s,
      getCastDevice: () =>
        new Promise<{ deviceId: string; friendlyName: string }>((r) => {
          resolve = r;
        }),
      arrive: () => resolve({ deviceId: name, friendlyName: name }),
    };
  }

  it("sends the new TV page to the receiver when the game changes it", async () => {
    const { sm, store } = setup();
    store.dispatch({ type: "SET_VIEW_URL", url: "https://game/tv/AB" });
    const session = fakeSession();
    sm.emitStarted(session);
    await flush();
    store.dispatch({ type: "SET_VIEW_URL", url: "https://game/tv/CD" });
    store.dispatch({ type: "SET_VIEW_URL", url: "https://game/tv/CD" });
    store.dispatch({ type: "RESET_ERROR" });
    store.dispatch({ type: "SET_ERROR", error: "unrelated" });
    await flush();
    expect(session.sent.map(viewUrlOf)).toEqual(["https://game/tv/AB", "https://game/tv/CD"]);
  });

  it("never writes to a suspended session's dead socket (native SSLWrite crash, #44)", async () => {
    const { sm, store } = setup();
    store.dispatch({ type: "SET_VIEW_URL", url: "https://game/tv/AB" });
    const session = fakeSession();
    sm.emitStarted(session);
    await flush();
    sm.emitSuspended();
    store.dispatch({ type: "SET_VIEW_URL", url: "https://game/tv/CD" });
    session.receive({ type: "REQUEST_VIEW" });
    await flush();
    expect(session.sent.map(viewUrlOf)).toEqual(["https://game/tv/AB"]);
    sm.emitResumed(session);
    await flush();
    expect(session.sent.map(viewUrlOf)).toEqual(["https://game/tv/AB", "https://game/tv/CD"]);
  });

  it("a late channel from an older session never takes the newer one's place", async () => {
    const { sm, store } = setup();
    store.dispatch({ type: "SET_VIEW_URL", url: "https://game/tv/AB" });
    let openA: () => void = () => {};
    const a = fakeSession("Den TV", "den");
    const slowA = {
      ...a,
      addChannel: () =>
        new Promise<Awaited<ReturnType<typeof a.addChannel>>>((resolve) => {
          openA = () => void a.addChannel().then(resolve);
        }),
    };
    const b = fakeSession("Kitchen TV", "kitchen");
    sm.emitStarted(slowA);
    sm.emitEnded();
    sm.emitStarted(b);
    await flush();
    openA();
    await flush();
    store.dispatch({ type: "SET_VIEW_URL", url: "https://game/tv/CD" });
    await flush();
    expect(b.sent.map(viewUrlOf)).toEqual(["https://game/tv/AB", "https://game/tv/CD"]);
  });

  it("a session that ends before its device is known stays ended", async () => {
    const { sm, store } = setup();
    const a = slowSession("Den TV");
    sm.emitStarted(a);
    sm.emitEnded();
    a.arrive();
    await flush();
    expect(store.getSnapshot().session.status).toBe("disconnected");
  });

  it("a late answer from an older session never overrides the newer one", async () => {
    const { sm, store } = setup();
    const a = slowSession("Den TV");
    const b = slowSession("Kitchen TV");
    sm.emitStarted(a);
    sm.emitEnded();
    sm.emitStarted(b);
    b.arrive();
    await flush();
    a.arrive();
    await flush();
    expect(store.getSnapshot().session.deviceName).toBe("Kitchen TV");
  });

  it("a session lookup that answers after teardown changes nothing", async () => {
    let answer: (s: FakeSession | null) => void = () => {};
    const sm = fakeSessionManager();
    sm.getCurrentCastSession.mockImplementation(
      () =>
        new Promise<FakeSession | null>((r) => {
          answer = r;
        }),
    );
    const commands = castCommands();
    const store = createCastStore(commands);
    const stop = startCastSync(store, sm, commands, "https://stream.example");
    stop();
    answer(fakeSession());
    await flush();
    expect(store.getSnapshot().session.status).toBe("disconnected");
  });

  it("names the TV from discovery when the session can't say which device it is", async () => {
    const { sm, store } = setup();
    store.dispatch({ type: "DEVICES_UPDATED", devices: [TV_ONLY] });
    const s = { ...fakeSession(), getCastDevice: () => Promise.reject(new Error("no device")) };
    sm.emitStarted(s);
    await flush();
    expect(store.getSnapshot().session).toMatchObject({
      status: "connected",
      deviceName: "Only TV",
    });
  });
});

const TV_ONLY = { id: "only", name: "Only TV", type: "chromecast" as const };
