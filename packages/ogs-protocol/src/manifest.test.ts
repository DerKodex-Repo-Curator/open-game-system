import { describe, expect, it } from "vitest";
import { ManifestSchema, RoleSchema, TvNeedSchema } from "./manifest";

const valid = () => ({
  appId: "rocket-crew",
  name: "Rocket Crew",
  shape: "couch",
  tv: "required",
  startUrl: "https://rocket-crew.example/play",
  art: { tile: "https://rocket-crew.example/tile.png" },
});

const without = (key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(valid()).filter(([k]) => k !== key));

describe("game manifest", () => {
  it("accepts a minimal manifest and fills in the defaults", () => {
    expect(ManifestSchema.parse(valid())).toEqual({
      ...valid(),
      tagline: "",
      roles: [],
      shop: {},
      instanceTtlMs: 7 * 24 * 60 * 60 * 1000,
    });
  });

  it("an instance stays listed for a week of silence by default", () => {
    expect(ManifestSchema.parse(valid()).instanceTtlMs).toBe(604_800_000);
  });

  it.each([
    "appId",
    "name",
    "shape",
    "tv",
    "startUrl",
    "art",
  ])("a manifest without %s is rejected", (key) => {
    expect(ManifestSchema.safeParse(without(key)).success).toBe(false);
  });

  it("a manifest without art.tile is rejected", () => {
    expect(ManifestSchema.safeParse({ ...valid(), art: {} }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...valid(), art: { tile: "" } }).success).toBe(false);
  });

  it("keeps the optional art: hero and the TV safe area", () => {
    const art = {
      tile: "tile.png",
      hero: "hero.png",
      safe: { scale: 0.9, ox: 0.05, oy: -0.02 },
    };
    expect(ManifestSchema.parse({ ...valid(), art }).art).toEqual(art);
  });

  it("keeps the art kit: square icon, portrait cover, transparent logo, clean hero", () => {
    const art = {
      tile: "tile.png",
      icon: "/art/rocket-crew/icon.png",
      cover: "/art/rocket-crew/cover.jpg",
      logo: "/art/rocket-crew/logo.png",
      heroClean: "/art/rocket-crew/hero-clean.jpg",
    };
    expect(ManifestSchema.parse({ ...valid(), art }).art).toEqual(art);
  });

  it("keeps the optional theme: the audio loop the launcher plays while the game is focused", () => {
    const art = { tile: "tile.png", theme: "/art/rocket-crew/theme.mp3" };
    expect(ManifestSchema.parse({ ...valid(), art }).art).toEqual(art);
  });

  it("a game without a theme has none", () => {
    expect(ManifestSchema.parse(valid()).art.theme).toBeUndefined();
  });

  it.each(["icon", "cover", "logo", "heroClean", "theme"])("an empty art.%s is rejected", (key) => {
    const art = { tile: "tile.png", [key]: "" };
    expect(ManifestSchema.safeParse({ ...valid(), art }).success).toBe(false);
  });

  it.each([0, -1])("a safe-area scale of %s is rejected", (scale) => {
    const art = { tile: "tile.png", safe: { scale, ox: 0, oy: 0 } };
    expect(ManifestSchema.safeParse({ ...valid(), art }).success).toBe(false);
  });

  it("a safe area missing an offset is rejected", () => {
    const art = { tile: "tile.png", safe: { scale: 1, ox: 0 } };
    expect(ManifestSchema.safeParse({ ...valid(), art }).success).toBe(false);
  });

  it.each(["rocket-crew", "bake-shop-2", "x"])("accepts the app id %s", (appId) => {
    expect(ManifestSchema.parse({ ...valid(), appId }).appId).toBe(appId);
  });

  it.each([
    "",
    "Rocket-crew",
    "rocket-crew!",
    "rocket crew",
    "rocket_crew",
    "ROCKET",
  ])("rejects the app id %j (lowercase letters, digits and dashes only)", (appId) => {
    expect(ManifestSchema.safeParse({ ...valid(), appId }).success).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(ManifestSchema.safeParse({ ...valid(), name: "" }).success).toBe(false);
  });

  it.each(["couch", "live", "async"])("accepts the shape %s", (shape) => {
    expect(ManifestSchema.parse({ ...valid(), shape }).shape).toBe(shape);
  });

  it("rejects an unknown shape", () => {
    expect(ManifestSchema.safeParse({ ...valid(), shape: "solo" }).success).toBe(false);
  });

  it.each(["none", "optional", "required"])("accepts the TV need %s", (tv) => {
    expect(TvNeedSchema.parse(tv)).toBe(tv);
    expect(ManifestSchema.parse({ ...valid(), tv }).tv).toBe(tv);
  });

  it("rejects an unknown TV need", () => {
    expect(TvNeedSchema.safeParse("sometimes").success).toBe(false);
  });

  it("start and TV pages must be URLs; the TV page is optional", () => {
    expect(ManifestSchema.safeParse({ ...valid(), startUrl: "play" }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...valid(), tvUrl: "tv" }).success).toBe(false);
    const tvUrl = "https://rocket-crew.example/tv";
    expect(ManifestSchema.parse({ ...valid(), tvUrl }).tvUrl).toBe(tvUrl);
  });

  it("a try path is optional and must be a URL", () => {
    expect(ManifestSchema.parse(valid()).tryUrl).toBeUndefined();
    expect(ManifestSchema.safeParse({ ...valid(), tryUrl: "try" }).success).toBe(false);
    const tryUrl = "https://try.rocket-crew.example/";
    expect(ManifestSchema.parse({ ...valid(), tryUrl }).tryUrl).toBe(tryUrl);
  });

  it("keeps the tagline, roles and shop facts it is given", () => {
    const roles = [
      { id: "captain", label: "Captain", audience: "grownup" },
      { id: "fixer", label: "Fixer", audience: "kid" },
    ];
    const shop = { ages: "3+", minutes: [10, 20], players: "2-4" };
    const m = ManifestSchema.parse({ ...valid(), tagline: "Fly together", roles, shop });
    expect(m.tagline).toBe("Fly together");
    expect(m.roles).toEqual(roles);
    expect(m.shop).toEqual(shop);
  });

  it("shop minutes is a [min, max] pair", () => {
    const shop = { minutes: [10] };
    expect(ManifestSchema.safeParse({ ...valid(), shop }).success).toBe(false);
  });

  it.each([0, -5])("an instance TTL of %s is rejected", (instanceTtlMs) => {
    expect(ManifestSchema.safeParse({ ...valid(), instanceTtlMs }).success).toBe(false);
  });

  it("keeps a custom instance TTL", () => {
    expect(ManifestSchema.parse({ ...valid(), instanceTtlMs: 3_600_000 }).instanceTtlMs).toBe(
      3_600_000,
    );
  });
});

describe("game role", () => {
  const role = { id: "captain", label: "Captain", audience: "grownup" };

  it.each(["grownup", "kid", "little"])("accepts the audience %s", (audience) => {
    expect(RoleSchema.parse({ ...role, audience })).toEqual({ ...role, audience });
  });

  it("rejects an unknown audience", () => {
    expect(RoleSchema.safeParse({ ...role, audience: "teen" }).success).toBe(false);
  });

  it.each(["id", "label"])("rejects a role with an empty or missing %s", (key) => {
    expect(RoleSchema.safeParse({ ...role, [key]: "" }).success).toBe(false);
    const rest = Object.fromEntries(Object.entries(role).filter(([k]) => k !== key));
    expect(RoleSchema.safeParse(rest).success).toBe(false);
  });

  it("a manifest with an invalid role is rejected", () => {
    const roles = [{ id: "captain", label: "Captain" }];
    expect(ManifestSchema.safeParse({ ...valid(), roles }).success).toBe(false);
  });
});
