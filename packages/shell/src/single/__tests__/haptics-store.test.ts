import { createHapticsStore, type HapticsPlayer } from "../haptics-store";

function fakePlayer() {
  const played: string[] = [];
  const player: HapticsPlayer = {
    impact: async (style) => {
      played.push(`impact:${style}`);
    },
    notify: async (kind) => {
      played.push(`notify:${kind}`);
    },
  };
  return { player, played };
}

describe("haptics bridge store", () => {
  it("plays IMPACT and NOTIFY from the page", () => {
    const { player, played } = fakePlayer();
    const store = createHapticsStore(player);
    store.dispatch({ type: "IMPACT", style: "heavy" });
    store.dispatch({ type: "NOTIFY", kind: "success" });
    store.dispatch({ type: "IMPACT", style: "light" });
    expect(played).toEqual(["impact:heavy", "notify:success", "impact:light"]);
  });

  it("ignores anything that doesn't parse", () => {
    const { player, played } = fakePlayer();
    const store = createHapticsStore(player);
    store.dispatch({ type: "IMPACT", style: "rigid" });
    store.dispatch({ type: "NOTIFY" });
    store.dispatch({ type: "VIBRATE", ms: 500 });
    expect(played).toEqual([]);
  });

  it("swallows a haptics failure (no haptic engine)", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const store = createHapticsStore({
      impact: () => Promise.reject(new Error("no engine")),
      notify: () => Promise.reject(new Error("no engine")),
    });
    expect(() => store.dispatch({ type: "IMPACT", style: "light" })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("has a constant empty state and tells subscribers it at once", () => {
    const store = createHapticsStore(fakePlayer().player);
    expect(store.getSnapshot()).toEqual({});
    const seen: unknown[] = [];
    const off = store.subscribe((s) => seen.push(s));
    expect(seen).toEqual([{}]);
    off();
    store.reset();
    expect(store.getSnapshot()).toEqual({});
    expect(typeof store.on("IMPACT", () => {})).toBe("function");
  });
});
