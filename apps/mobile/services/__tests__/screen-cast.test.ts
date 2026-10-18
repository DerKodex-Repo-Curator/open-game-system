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
