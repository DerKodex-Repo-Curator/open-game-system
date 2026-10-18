import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGUE, catalogueIds, findManifest } from "../src/catalogue";

/** Adult party games: no kid seat (Jon, 2026-10-06: Trivia Jam is for adults; 2026-10-07: Little Vigilante is 10+ hidden roles). */
const ADULT_GAMES = [
  "trivia-jam",
  "codebreakers",
  "little-vigilante",
  "run-set-jimmy",
  "settlewood",
];
/** Games served from their own domain instead of <appId>.jonathanrmumm.workers.dev (Jon, 2026-10-06). */
const OWN_DOMAIN: Record<string, string> = { "trivia-jam": "https://triviajam.tv/" };
const GAMES = [
  "rocket-crew",
  "bake-shop",
  "story-nook",
  "peekaboo-garden",
  "night-flight",
  "trivia-jam",
  "codebreakers",
  "little-vigilante",
  "bobberbrook",
  "run-set-jimmy",
  "settlewood",
  "midnight-museum",
];
/** Grown-up games played over days on phones, with the TV optional (2026-10-05). */
const ASYNC_GAMES = ["pocket-draft"];
/** Games with a theme loop cut from their own music (2026-10-04; Trivia Jam, Codebreakers, Pocket Draft 2026-10-07); the rest are silent on Home. */
const THEMED = [
  "rocket-crew",
  "bake-shop",
  "story-nook",
  "peekaboo-garden",
  "night-flight",
  "little-vigilante",
  "trivia-jam",
  "codebreakers",
  "pocket-draft",
  "run-set-jimmy",
  "midnight-museum",
];

describe("catalogue", () => {
  it("lists the deployed games in order: couch games, then async games", () => {
    expect(CATALOGUE.map((m) => m.appId)).toEqual([...GAMES, ...ASYNC_GAMES]);
    expect(catalogueIds()).toEqual([...GAMES, ...ASYNC_GAMES]);
  });

  it("pocket-draft is a grown-up, multi-couch async game whose TV is optional", () => {
    const m = findManifest("pocket-draft");
    expect(m?.shape).toBe("async");
    expect(m?.tv).toBe("optional");
    expect(m?.tvUrl).toBeUndefined();
    expect(m?.multiCouch).toBe(true);
    expect(m?.startUrl).toBe("https://pocket-draft-room.jonathanrmumm.workers.dev/");
    expect(m?.art.tile).toBe("/art/pocket-draft/tv.jpg");
    expect(m?.art.theme).toBe("/art/pocket-draft/theme.mp3");
    expect(m?.roles.map((r) => r.audience)).toEqual(["grownup"]);
  });

  it.each(GAMES)("%s is a room-based couch game that needs the TV", (appId) => {
    const m = findManifest(appId);
    expect(m).toBeDefined();
    expect(m?.shape).toBe("couch");
    expect(m?.tv).toBe("required");
    expect(m?.tvUrl).toBeUndefined();
    expect(m?.startUrl).toBe(OWN_DOMAIN[appId] ?? `https://${appId}.jonathanrmumm.workers.dev/`);
    expect(m?.art.tile).toBe(`/art/${appId}/tv.jpg`);
    expect(m?.roles.some((r) => r.audience === "grownup")).toBe(true);
    // Family games have a kid seat; adult party games (trivia-jam) deliberately don't.
    if (!ADULT_GAMES.includes(appId)) expect(m?.roles.some((r) => r.audience === "kid")).toBe(true);
  });

  it.each(ADULT_GAMES)("%s is an adult party game: every role is a grown-up", (appId) => {
    const m = findManifest(appId);
    expect(m?.roles.length).toBeGreaterThan(0);
    expect(m?.roles.every((r) => r.audience === "grownup")).toBe(true);
  });

  it("does not know other games", () => {
    expect(findManifest("word-duel")).toBeUndefined();
  });

  it.each(
    CATALOGUE.map((g) => [g.appId, g] as const),
  )("%s has the full art kit, and every file is in the TV app", (_id, game) => {
    const kit = [game.art.icon, game.art.cover, game.art.logo, game.art.heroClean];
    expect(kit.every((p) => typeof p === "string" && p.length > 0)).toBe(true);
    for (const p of kit)
      expect(existsSync(join(__dirname, "../../../apps/tv/public", String(p)))).toBe(true);
  });

  it.each(THEMED)("%s has a music theme for the launcher's Home, in the TV app", (appId) => {
    const theme = findManifest(appId)?.art.theme;
    expect(theme).toBe(`/art/${appId}/theme.mp3`);
    expect(existsSync(join(__dirname, "../../../apps/tv/public", String(theme)))).toBe(true);
  });

  it.each(
    GAMES.filter((g) => !THEMED.includes(g)),
  )("%s has no theme yet: Home is silent on it", (appId) => {
    expect(findManifest(appId)?.art.theme).toBeUndefined();
  });
});
