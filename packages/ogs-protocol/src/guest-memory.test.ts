import { describe, expect, it } from "vitest";
import { GUEST_KEY, rememberedGuest, rememberGuest } from "./guest";

// The second visit (docs/acceptance/2026-10-18-second-visit.feature, "Grandma joins again in one
// tap"): the browser a guest joined from remembers her name and sticker, so the join page can
// offer "Join as Grandma" instead of the form.
function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => {
      items.set(k, v);
    },
  };
}

describe("a guest remembered on this browser", () => {
  it("keeps the name and sticker she joined with, and reads them back", () => {
    const store = memory();
    rememberGuest(store, { name: "  Grandma ", sticker: "owl" });
    expect(rememberedGuest(store)).toEqual({ name: "Grandma", sticker: "owl" });
    expect(JSON.parse(store.items.get(GUEST_KEY) ?? "")).toEqual({ name: "Grandma", sticker: "owl" });
  });

  it("is nobody on a browser that never joined", () => {
    expect(rememberedGuest(memory())).toBeNull();
  });

  it("ignores what doesn't parse: not JSON, an empty or too-long name, an unknown sticker", () => {
    for (const raw of ["{", "null", '"Grandma"', JSON.stringify({ name: " ", sticker: "owl" })])
      expect(rememberedGuest(memory({ [GUEST_KEY]: raw }))).toBeNull();
    const long = { name: "x".repeat(31), sticker: "owl" };
    expect(rememberedGuest(memory({ [GUEST_KEY]: JSON.stringify(long) }))).toBeNull();
    const odd = { name: "Grandma", sticker: "unicorn" };
    expect(rememberedGuest(memory({ [GUEST_KEY]: JSON.stringify(odd) }))).toBeNull();
  });

  it("doesn't remember a name it wouldn't take", () => {
    const store = memory();
    rememberGuest(store, { name: "   ", sticker: "owl" });
    rememberGuest(store, { name: "Grandma", sticker: "unicorn" });
    expect(store.items.size).toBe(0);
  });

  it("works where storage is missing or throws (private mode)", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(rememberedGuest(throwing)).toBeNull();
    expect(() => rememberGuest(throwing, { name: "Grandma", sticker: "owl" })).not.toThrow();
    expect(rememberedGuest(null)).toBeNull();
    expect(() => rememberGuest(null, { name: "Grandma", sticker: "owl" })).not.toThrow();
  });
});
