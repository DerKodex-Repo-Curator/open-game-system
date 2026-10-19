import { castTarget } from "../../components/ogs/remote/last-stop";
import { createLastTv, LAST_TV_KEY, rememberConnectedTv } from "../last-tv";

// The second visit (docs/acceptance/2026-10-18-second-visit.feature, "The TV is remembered on both
// sides"): the TV this phone cast to last is the Cast button's TV after the app restarts, ahead of
// whichever TV happens to be found first.
const living = { id: "tv-1", name: "Living room TV", type: "chromecast" as const };
const laptop = { id: "screen:abc", name: "Browser TV", type: "browser" as const };

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: async (k: string) => items.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      items.set(k, v);
    },
  };
}

describe("lastTv: the TV this phone cast to last, kept across launches", () => {
  it("remembers a TV, tells listeners, and a fresh start reads it back", async () => {
    const storage = memory();
    const first = createLastTv({ storage });
    await first.ready;
    const seen = jest.fn();
    first.subscribe(seen);
    await first.remember({ id: "screen:abc", name: "Browser TV" });
    expect(first.get()).toEqual({ id: "screen:abc", name: "Browser TV" });
    expect(seen).toHaveBeenCalledTimes(1);

    const next = createLastTv({ storage });
    expect(next.get()).toBeNull();
    await next.ready;
    expect(next.get()).toEqual({ id: "screen:abc", name: "Browser TV" });
  });

  it("the same TV again changes nothing and tells no one", async () => {
    const tvs = createLastTv({ storage: memory() });
    await tvs.remember({ id: "tv-1", name: "Living room TV" });
    const seen = jest.fn();
    tvs.subscribe(seen);
    await tvs.remember({ id: "tv-1", name: "Living room TV" });
    expect(seen).not.toHaveBeenCalled();
  });

  it("reads anything it can't parse as no TV", async () => {
    for (const raw of ["{", "null", JSON.stringify({ id: "" }), JSON.stringify([1])]) {
      const tvs = createLastTv({ storage: memory({ [LAST_TV_KEY]: raw }) });
      await tvs.ready;
      expect(tvs.get()).toBeNull();
    }
  });

  it("a TV remembered while it loaded wins over the stored one", async () => {
    const storage = memory({
      [LAST_TV_KEY]: JSON.stringify({ id: "tv-1", name: "Living room TV" }),
    });
    const tvs = createLastTv({ storage });
    await tvs.remember({ id: "screen:abc", name: "Browser TV" });
    await tvs.ready;
    expect(tvs.get()?.id).toBe("screen:abc");
  });
});

describe("rememberConnectedTv: a cast that connects is the TV to remember", () => {
  function castLike() {
    let session: { status: string; deviceId: string | null; deviceName: string | null } = {
      status: "disconnected",
      deviceId: null,
      deviceName: null,
    };
    const listeners = new Set<() => void>();
    return {
      getSnapshot: () => ({ session }),
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      set(next: typeof session) {
        session = next;
        for (const l of listeners) l();
      },
    };
  }

  it("remembers the TV once the cast is connected, not while it connects", async () => {
    const cast = castLike();
    const tvs = createLastTv({ storage: memory() });
    rememberConnectedTv(cast, tvs);
    cast.set({ status: "connecting", deviceId: "screen:abc", deviceName: "Browser TV" });
    expect(tvs.get()).toBeNull();
    cast.set({ status: "connected", deviceId: "screen:abc", deviceName: "Browser TV" });
    expect(tvs.get()).toEqual({ id: "screen:abc", name: "Browser TV" });
  });
});

describe("castTarget with the TV cast to last", () => {
  it("picks the last TV over the first one found, when it's there", () => {
    expect(castTarget([living, laptop], null, null, { id: "screen:abc", name: "Browser TV" })).toBe(
      laptop,
    );
  });

  it("falls back to the first TV found when the last TV isn't on the network", () => {
    expect(castTarget([living], null, null, { id: "screen:abc", name: "Browser TV" })).toBe(living);
  });

  it("a TV picked or just stopped still comes first", () => {
    const last = { id: "screen:abc", name: "Browser TV" };
    expect(castTarget([living, laptop], living, null, last)).toBe(living);
    expect(castTarget([living, laptop], null, { id: "tv-1", name: "Living room TV" }, last)).toBe(
      living,
    );
  });
});
