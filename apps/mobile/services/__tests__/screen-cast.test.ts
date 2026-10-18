import type { CastBackend } from "../cast-backend";
import type { CastDevice } from "../cast-store";
import type { SessionManagerLike } from "../cast-sync";
import { createFakeCastBackend, FAKE_TV } from "../fake-cast";
import { combineCastBackends, createScreenCastBackend, type ScreensApi } from "../screen-cast";

// Acceptance: 2026-10-17-browser-tv.feature. A browser TV is one of the phone's TVs: typed in once
// by its code, cast to like a Chromecast (LOAD_VIEW shows the launcher there), stopped the same way.

const VIEW = "http://localhost:5300/?api=http%3A%2F%2Fapi.test&token=launcher-token-1";

function fakeApi() {
  const calls: string[] = [];
  const api: ScreensApi = {
    async claim(code) {
      calls.push(`claim:${code}`);
      if (code === "QQQQQQ")
        throw Object.assign(new Error("No screen shows that code"), { code: "screen_not_found" });
      return { screenId: "sc1", name: "Browser TV" };
    },
    async show(screenId, token) {
      calls.push(`show:${screenId}:${token}`);
    },
    async stop(screenId) {
      calls.push(`stop:${screenId}`);
    },
  };
  return { api, calls };
}

function memory() {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: async (k: string) => data[k] ?? null,
    setItem: async (k: string, v: string) => {
      data[k] = v;
    },
  };
}

describe("a browser TV as a cast device", () => {
  it("has no TVs until a code is typed, then the screen, kept for next time", async () => {
    const { api, calls } = fakeApi();
    const storage = memory();
    const screens = createScreenCastBackend({ api, storage });
    await screens.ready;
    expect(screens.getDevices()).toEqual([]);
    const seen: string[][] = [];
    screens.subscribeDevices((d) => seen.push(d.map((x) => x.name)));
    expect(await screens.addScreen("hsu-nh9")).toEqual({
      ok: true,
      device: { id: "screen:sc1", name: "Browser TV", type: "browser" },
    });
    expect(calls).toEqual(["claim:hsu-nh9"]);
    expect(seen).toEqual([["Browser TV"]]);

    const again = createScreenCastBackend({ api, storage });
    await again.ready;
    expect(again.getDevices()).toEqual([{ id: "screen:sc1", name: "Browser TV", type: "browser" }]);
  });

  it("a code no screen shows says so and adds nothing", async () => {
    const screens = createScreenCastBackend({ api: fakeApi().api, storage: memory() });
    expect(await screens.addScreen("QQQQQQ")).toEqual({
      ok: false,
      message: "No TV shows that code. Check the code on the TV.",
    });
    expect(screens.getDevices()).toEqual([]);
  });

  it("the same screen typed twice is one TV", async () => {
    const screens = createScreenCastBackend({ api: fakeApi().api, storage: memory() });
    await screens.addScreen("HSUNH9");
    await screens.addScreen("HSUNH9");
    expect(screens.getDevices()).toHaveLength(1);
  });

  it("cast: the session starts, LOAD_VIEW shows the launcher token there; stop stops it", async () => {
    const { api, calls } = fakeApi();
    const screens = createScreenCastBackend({ api, storage: memory() });
    await screens.addScreen("HSUNH9");
    const events: string[] = [];
    screens.sessionManager.onSessionStarted(() => events.push("started"));
    screens.sessionManager.onSessionEnded(() => events.push("ended"));
    expect(await screens.sessionManager.startSession("screen:sc1")).toBe(true);
    const session = await screens.sessionManager.getCurrentCastSession();
    expect(await session?.getCastDevice()).toEqual({
      deviceId: "screen:sc1",
      friendlyName: "Browser TV",
    });
    const channel = await session?.addChannel("urn:x-cast:org.opengame.view");
    await channel?.sendMessage({ type: "LOAD_VIEW", viewUrl: VIEW });
    await channel?.sendMessage(JSON.stringify({ type: "SOMETHING_ELSE" }));
    await screens.sessionManager.endCurrentSession();
    expect(calls.slice(1)).toEqual(["show:sc1:launcher-token-1", "stop:sc1"]);
    expect(events).toEqual(["started", "ended"]);
    expect(await screens.sessionManager.getCurrentCastSession()).toBeNull();
  });

  it("an unknown TV doesn't start", async () => {
    const screens = createScreenCastBackend({ api: fakeApi().api, storage: memory() });
    expect(await screens.sessionManager.startSession("screen:nope")).toBe(false);
  });
});

describe("Chromecasts and browser TVs together", () => {
  const setup = async () => {
    const cast = createFakeCastBackend({
      mode: "one",
      loadUrl: "http://fake/load",
      fetch: async () => new Response("{}"),
    });
    const { api, calls } = fakeApi();
    const screens = createScreenCastBackend({ api, storage: memory() });
    await screens.addScreen("HSUNH9");
    return { both: combineCastBackends(cast, screens), calls };
  };

  it("lists the Chromecasts it finds, then the browser TVs", async () => {
    const { both } = await setup();
    both.startDiscovery();
    expect(both.getDevices().map((d) => d.id)).toEqual([FAKE_TV.id, "screen:sc1"]);
  });

  it("starts the TV on whichever side has it, and ends that one", async () => {
    const { both, calls } = await setup();
    const started: string[] = [];
    both.sessionManager.onSessionStarted(async (s) =>
      started.push((await s.getCastDevice())?.deviceId ?? ""),
    );
    expect(await both.sessionManager.startSession("screen:sc1")).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(["screen:sc1"]);
    await both.sessionManager.endCurrentSession();
    expect(calls).toContain("stop:sc1");
    expect(await both.sessionManager.getCurrentCastSession()).toBeNull();
    expect(await both.sessionManager.startSession(FAKE_TV.id)).toBe(true);
    expect(await (await both.sessionManager.getCurrentCastSession())?.getCastDevice()).toEqual({
      deviceId: FAKE_TV.id,
      friendlyName: FAKE_TV.name,
    });
  });

  // The cast prompt reads devices with useSyncExternalStore: a new array per read loops forever.
  it("gives the same list while nothing changes, a new one when it does", async () => {
    const { both } = await setup();
    both.startDiscovery();
    const first = both.getDevices();
    expect(both.getDevices()).toBe(first);
    const screens = createScreenCastBackend({ api: fakeApi().api, storage: memory() });
    const before = screens.getDevices();
    expect(screens.getDevices()).toBe(before);
    await screens.addScreen("HSUNH9");
    expect(screens.getDevices()).not.toBe(before);
  });

  it("tells a device list listener about either side changing", async () => {
    const { both } = await setup();
    const counts: number[] = [];
    both.subscribeDevices((d) => counts.push(d.length));
    both.startDiscovery();
    expect(counts.at(-1)).toBe(2);
  });
});

// ---- Edges (mutation testing): storage, messages, subscriptions, and which side a call goes to.

type Session = NonNullable<Awaited<ReturnType<SessionManagerLike["getCurrentCastSession"]>>>;
const EVENTS = [
  "starting",
  "started",
  "startFailed",
  "suspended",
  "resumed",
  "ending",
  "ended",
] as const;
type EventName = (typeof EVENTS)[number];

/** A cast backend whose events a test fires by hand. */
function stubBackend(devices: CastDevice[]) {
  const sets = new Map<EventName, Set<() => void>>(EVENTS.map((n) => [n, new Set()]));
  const fake: Session = {
    getCastDevice: async () => null,
    addChannel: async () => ({ sendMessage: async () => {}, onMessage: () => {} }),
  };
  /** Subscribes `fn`, called with what `args` gives when the event fires. */
  const on =
    <A extends unknown[]>(n: EventName, args: () => A) =>
    (fn: (...a: A) => void) => {
      const call = () => fn(...args());
      sets.get(n)?.add(call);
      return { remove: () => void sets.get(n)?.delete(call) };
    };
  const none = (): [] => [];
  const calls: string[] = [];
  let current: Session | null = null;
  const listeners = new Set<(d: CastDevice[]) => void>();
  const backend: CastBackend = {
    sessionManager: {
      getCurrentCastSession: async () => current,
      async startSession(id: string) {
        calls.push(`start:${id}`);
        if (!devices.some((d) => d.id === id)) return false;
        current = {
          getCastDevice: async () => ({ deviceId: id, friendlyName: id }),
          addChannel: async () => ({ sendMessage: async () => {}, onMessage: () => {} }),
        };
        return true;
      },
      async endCurrentSession() {
        calls.push("end");
        current = null;
      },
      onSessionStarting: on("starting", none),
      onSessionStarted: on("started", (): [Session] => [fake]),
      onSessionStartFailed: on("startFailed", (): [Session, string] => [fake, "x"]),
      onSessionSuspended: on("suspended", none),
      onSessionResumed: on("resumed", (): [Session] => [fake]),
      onSessionEnding: on("ending", none),
      onSessionEnded: on("ended", none),
    },
    startDiscovery: () => void calls.push("discover"),
    getDevices: () => devices,
    subscribeDevices(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    showCastDialog: () => void calls.push("dialog"),
  };
  return {
    backend,
    calls,
    names: EVENTS,
    fire: (n: EventName) => {
      for (const fn of sets.get(n) ?? []) fn();
    },
    publish: () => {
      for (const l of listeners) l(devices);
    },
  };
}

function apiWith(claims: Record<string, { screenId: string; name: string } | Error>) {
  const calls: string[] = [];
  const api: ScreensApi = {
    async claim(code) {
      const c = claims[code];
      if (!c || c instanceof Error) throw c ?? new Error("nope");
      return c;
    },
    async show(id, token) {
      calls.push(`show:${id}:${token}`);
    },
    async stop(id) {
      calls.push(`stop:${id}`);
    },
  };
  return { api, calls };
}
const TWO = {
  AAAAAA: { screenId: "a", name: "Den TV" },
  BBBBBB: { screenId: "b", name: "Browser TV" },
};

describe("browser TVs, kept and listed", () => {
  it("start with none, then read the kept ones under their own key", async () => {
    const storage = memory();
    storage.data["ogs.browserTvs"] = JSON.stringify([{ screenId: "k", name: "Kept TV" }]);
    const screens = createScreenCastBackend({ api: apiWith({}).api, storage });
    expect(screens.getDevices()).toEqual([]);
    await screens.ready;
    expect(screens.getDevices()).toEqual([{ id: "screen:k", name: "Kept TV", type: "browser" }]);
  });

  it("an unreadable list is none", async () => {
    for (const raw of ["{", JSON.stringify([{ nope: 1 }])]) {
      const storage = memory();
      storage.data["ogs.browserTvs"] = raw;
      const screens = createScreenCastBackend({ api: apiWith({}).api, storage });
      await screens.ready;
      expect(screens.getDevices()).toEqual([]);
    }
  });

  it("a TV typed in before the kept list loads isn't lost when it does", async () => {
    let release: (v: string | null) => void = () => {};
    const storage = {
      getItem: () => new Promise<string | null>((r) => (release = r)),
      setItem: async () => {},
    };
    const screens = createScreenCastBackend({ api: apiWith(TWO).api, storage });
    await screens.addScreen("AAAAAA");
    release(JSON.stringify([{ screenId: "k", name: "Kept TV" }]));
    await screens.ready;
    expect(screens.getDevices().map((d) => d.id)).toEqual(["screen:a"]);
  });

  it("typing a second screen keeps the first; typing the first again doesn't double it", async () => {
    const screens = createScreenCastBackend({ api: apiWith(TWO).api, storage: memory() });
    await screens.addScreen("AAAAAA");
    await screens.addScreen("BBBBBB");
    await screens.addScreen("AAAAAA");
    expect(screens.getDevices().map((d) => d.id)).toEqual(["screen:b", "screen:a"]);
  });

  it("only 'no screen shows that code' blames the code; anything else is the connection", async () => {
    const screens = createScreenCastBackend({
      api: apiWith({
        CCCCCC: Object.assign(new Error("x"), { code: "forbidden" }),
        DDDDDD: new Error("offline"),
      }).api,
      storage: memory(),
    });
    for (const code of ["CCCCCC", "DDDDDD"])
      expect(await screens.addScreen(code)).toEqual({
        ok: false,
        message: "Couldn't reach OGS. Check your connection and try again.",
      });
  });

  it("stops telling a device listener once it unsubscribes", async () => {
    const screens = createScreenCastBackend({ api: apiWith(TWO).api, storage: memory() });
    let told = 0;
    const off = screens.subscribeDevices(() => told++);
    off();
    await screens.addScreen("AAAAAA");
    expect(told).toBe(0);
  });
});

describe("casting to a browser TV, edges", () => {
  it("a LOAD_VIEW sent as JSON text shows too; other text is ignored", async () => {
    const { api, calls } = apiWith(TWO);
    const screens = createScreenCastBackend({ api, storage: memory() });
    await screens.addScreen("AAAAAA");
    await screens.sessionManager.startSession("screen:a");
    const session = await screens.sessionManager.getCurrentCastSession();
    const channel = await session?.addChannel("urn:x-cast:org.opengame.view");
    await channel?.sendMessage(JSON.stringify({ type: "LOAD_VIEW", viewUrl: VIEW }));
    await channel?.sendMessage("not json");
    expect(calls).toEqual(["show:a:launcher-token-1"]);
  });

  it("starts the TV it was asked for, among several", async () => {
    const screens = createScreenCastBackend({ api: apiWith(TWO).api, storage: memory() });
    await screens.addScreen("AAAAAA");
    await screens.addScreen("BBBBBB");
    await screens.sessionManager.startSession("screen:b");
    const s = await screens.sessionManager.getCurrentCastSession();
    expect(await s?.getCastDevice()).toEqual({ deviceId: "screen:b", friendlyName: "Browser TV" });
  });

  it("ending with nothing cast stops nothing and says nothing", async () => {
    const { api, calls } = apiWith(TWO);
    const screens = createScreenCastBackend({ api, storage: memory() });
    const events: string[] = [];
    screens.sessionManager.onSessionEnded(() => events.push("ended"));
    await screens.sessionManager.endCurrentSession();
    expect(calls).toEqual([]);
    expect(events).toEqual([]);
  });

  it("says starting and ending; a removed handler hears nothing; the others never fire", async () => {
    const screens = createScreenCastBackend({ api: apiWith(TWO).api, storage: memory() });
    await screens.addScreen("AAAAAA");
    const sm = screens.sessionManager;
    const heard: string[] = [];
    sm.onSessionStarting(() => heard.push("starting"));
    sm.onSessionEnding?.(() => heard.push("ending"));
    const gone = sm.onSessionStarted(() => heard.push("started"));
    gone.remove();
    for (const sub of [
      sm.onSessionStartFailed(() => heard.push("failed")),
      sm.onSessionSuspended(() => heard.push("suspended")),
      sm.onSessionResumed(() => heard.push("resumed")),
    ])
      sub.remove();
    await sm.startSession("screen:a");
    await sm.endCurrentSession();
    expect(heard).toEqual(["starting", "ending"]);
  });
});

describe("Chromecasts and browser TVs together, edges", () => {
  async function pair() {
    const cast = stubBackend([{ id: "cc", name: "Living room", type: "chromecast" }]);
    const { api, calls } = apiWith(TWO);
    const screens = createScreenCastBackend({ api, storage: memory() });
    await screens.addScreen("AAAAAA");
    await screens.addScreen("BBBBBB");
    return { cast, screens, calls, both: combineCastBackends(cast.backend, screens) };
  }

  it("passes on every session event from either side, until removed", async () => {
    const { cast, both } = await pair();
    const sm = both.sessionManager;
    const heard: string[] = [];
    const subs = [
      sm.onSessionStarting(() => heard.push("starting")),
      sm.onSessionStarted(() => heard.push("started")),
      sm.onSessionStartFailed(() => heard.push("startFailed")),
      sm.onSessionSuspended(() => heard.push("suspended")),
      sm.onSessionResumed(() => heard.push("resumed")),
      sm.onSessionEnding?.(() => heard.push("ending")),
      sm.onSessionEnded(() => heard.push("ended")),
    ];
    for (const n of cast.names) cast.fire(n);
    expect(heard).toEqual([...cast.names]);
    for (const s of subs) s?.remove();
    for (const n of cast.names) cast.fire(n);
    await sm.startSession("screen:a");
    expect(heard).toEqual([...cast.names]);
  });

  it("a side without 'ending' still subscribes", async () => {
    const cast = stubBackend([]);
    const noEnding: SessionManagerLike = {
      ...cast.backend.sessionManager,
      onSessionEnding: undefined,
    };
    const both = combineCastBackends(
      { ...cast.backend, sessionManager: noEnding },
      createScreenCastBackend({ api: apiWith({}).api, storage: memory() }),
    );
    expect(() => both.sessionManager.onSessionEnding?.(() => {}).remove()).not.toThrow();
  });

  it("starts each TV on its own side, among several browser TVs", async () => {
    const { cast, both } = await pair();
    expect(await both.sessionManager.startSession("screen:b")).toBe(true);
    expect(cast.calls).toEqual([]);
    expect(await both.sessionManager.startSession("cc")).toBe(true);
    expect(cast.calls).toEqual(["start:cc"]);
  });

  it("ends the side that started, not the one a failed start asked", async () => {
    const { cast, both, calls } = await pair();
    await both.sessionManager.startSession("screen:a");
    expect(await both.sessionManager.startSession("nowhere")).toBe(false);
    await both.sessionManager.endCurrentSession();
    expect(calls).toEqual(["stop:a"]);
    expect(cast.calls).toEqual(["start:nowhere"]);
    // Ended: a second end goes to the side with a session (none), not the old one again.
    await both.sessionManager.endCurrentSession();
    expect(calls).toEqual(["stop:a"]);
    expect(cast.calls).toEqual(["start:nowhere", "end"]);
  });

  it("with no start through it, ends a browser TV's session if one is up", async () => {
    const { both, screens, calls } = await pair();
    await screens.sessionManager.startSession("screen:a");
    await both.sessionManager.endCurrentSession();
    expect(calls).toEqual(["stop:a"]);
  });

  it("lists a new browser TV next to the same Chromecasts; a listener stops on unsubscribe", async () => {
    const cast = stubBackend([{ id: "cc", name: "Living room", type: "chromecast" }]);
    const screens = createScreenCastBackend({ api: apiWith(TWO).api, storage: memory() });
    const both = combineCastBackends(cast.backend, screens);
    expect(both.getDevices().map((d) => d.id)).toEqual(["cc"]);
    await screens.addScreen("AAAAAA");
    expect(both.getDevices().map((d) => d.id)).toEqual(["cc", "screen:a"]);
    let told = 0;
    const off = both.subscribeDevices(() => told++);
    cast.publish();
    expect(told).toBe(1);
    off();
    cast.publish();
    await screens.addScreen("BBBBBB");
    expect(told).toBe(1);
  });

  it("the Cast picker and discovery are the Chromecast side's", async () => {
    const { cast, both } = await pair();
    both.showCastDialog();
    both.startDiscovery();
    expect(cast.calls).toEqual(["dialog", "discover"]);
  });
});
