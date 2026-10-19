import type { CastDevice } from "../cast-store";
import {
  createFakeCastBackend,
  FAKE_TV,
  FAKE_TV_2,
  FAKE_TV_2_DELAY_MS,
  fakeCastOptions,
} from "../fake-cast";
import { createScreenCastBackend, type ScreensApi } from "../screen-cast";

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("fakeCastOptions, edges", () => {
  it("takes only a finite, non-negative end time", () => {
    for (const bad of ["", "-5", "abc", "Infinity"]) {
      expect(fakeCastOptions({ EXPO_PUBLIC_FAKE_CAST_END_MS: bad })).toEqual({});
    }
    expect(fakeCastOptions({ EXPO_PUBLIC_FAKE_CAST_END_MS: "0" })).toEqual({ endedAfterMs: 0 });
  });
});

describe("the fake Chromecast's TVs", () => {
  it("the second TV is the Bedroom TV, a Chromecast", () => {
    expect(FAKE_TV_2).toEqual({ id: "fake-bedroom", name: "Bedroom TV", type: "chromecast" });
  });

  function discovery(mode: "one" | "two") {
    const backend = createFakeCastBackend({
      mode,
      loadUrl: "https://fake-cast.test/load",
      fetch: async () => new Response(null, { status: 204 }),
    });
    const seen: CastDevice[][] = [];
    backend.subscribeDevices((d) => seen.push(d));
    return { backend, seen };
  }

  it("one TV: found once, and no second one arrives later", async () => {
    jest.useFakeTimers();
    const { backend, seen } = discovery("one");
    backend.startDiscovery();
    await jest.advanceTimersByTimeAsync(FAKE_TV_2_DELAY_MS * 2);
    expect(seen).toEqual([[FAKE_TV]]);
  });

  it("two TVs: a search while the second is on its way doesn't put it off", async () => {
    jest.useFakeTimers();
    const { backend } = discovery("two");
    backend.startDiscovery();
    await jest.advanceTimersByTimeAsync(FAKE_TV_2_DELAY_MS - 500);
    backend.startDiscovery();
    await jest.advanceTimersByTimeAsync(500);
    expect(backend.getDevices()).toEqual([FAKE_TV, FAKE_TV_2]);
  });

  it("ending a session twice at once stops the TV once", async () => {
    const stops: string[] = [];
    const backend = createFakeCastBackend({
      mode: "one",
      loadUrl: "https://fake-cast.test/load",
      fetch: async (url) => {
        stops.push(url);
        return new Response(null, { status: 204 });
      },
    });
    backend.startDiscovery();
    const ending = jest.fn();
    backend.sessionManager.onSessionEnding?.(ending);
    await backend.sessionManager.startSession(FAKE_TV.id);
    await Promise.all([
      backend.sessionManager.endCurrentSession(true),
      backend.sessionManager.endCurrentSession(true),
    ]);
    expect(ending).toHaveBeenCalledTimes(1);
    expect(stops.filter((u) => u.endsWith("/stop"))).toHaveLength(1);
  });
});

describe("a browser TV and a view without a launcher token", () => {
  it("shows nothing", async () => {
    const shows: unknown[][] = [];
    const api: ScreensApi = {
      claim: async () => ({ screenId: "sc1", name: "Browser TV" }),
      show: async (...args) => {
        shows.push(args);
      },
      stop: async () => {},
    };
    const data: Record<string, string> = {};
    const screens = createScreenCastBackend({
      api,
      storage: {
        getItem: async (k) => data[k] ?? null,
        setItem: async (k, v) => {
          data[k] = v;
        },
      },
    });
    await screens.ready;
    await screens.addScreen("KQTP7X");
    await screens.sessionManager.startSession("screen:sc1");
    const session = await screens.sessionManager.getCurrentCastSession();
    const channel = await session?.addChannel("urn:x-cast:org.opengame.view");
    await channel?.sendMessage(
      JSON.stringify({ type: "LOAD_VIEW", viewUrl: "https://tv.test/?api=x&chrome=none&app=a" }),
    );
    expect(shows).toEqual([]);
  });
});
