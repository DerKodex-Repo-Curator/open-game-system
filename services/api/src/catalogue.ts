import { type Manifest, ManifestSchema } from "@open-game-system/ogs-protocol";
import { z } from "zod";

/**
 * The OGS catalogue: the five deployed family games. All are room-based, so none has a static
 * `tvUrl`; the phone page sends the room's TV URL at runtime (`game.view`).
 */
const RoomGameManifestSchema = ManifestSchema;

/** Seed input: defaults (tagline, shop, instanceTtlMs) filled in by the parse. */
type ManifestInput = (typeof RoomGameManifestSchema)["_input"];

const workers = (appId: string) => `https://${appId}.jonathanrmumm.workers.dev/`;

const SEED: ManifestInput[] = [
  {
    appId: "rocket-crew",
    name: "Rocket Crew",
    tagline: "Fly the rocket together: the Captain reads, the Fixer presses.",
    shape: "couch",
    tv: "required",
    startUrl: workers("rocket-crew"),
    roles: [
      { id: "captain", label: "Captain", audience: "grownup" },
      { id: "fixer", label: "Fixer", audience: "kid" },
    ],
    art: {
      icon: "/art/rocket-crew/icon.png",
      cover: "/art/rocket-crew/cover.jpg",
      logo: "/art/rocket-crew/logo.png",
      heroClean: "/art/rocket-crew/hero-clean.jpg",
      theme: "/art/rocket-crew/theme.mp3",
      tile: "/art/rocket-crew/tv.jpg",
      hero: "/art/rocket-crew/tv.jpg",
      safe: { scale: 1.17, ox: 50, oy: 100 },
    },
    shop: { ages: "4+", minutes: [10, 20], players: "2" },
  },
  {
    appId: "bake-shop",
    name: "Bake Shop",
    tagline: "Animal customers, picture orders, a sprinkle of chaos.",
    shape: "couch",
    tv: "required",
    startUrl: workers("bake-shop"),
    roles: [
      { id: "grownup", label: "Grown-up", audience: "grownup" },
      { id: "baker", label: "Baker", audience: "kid" },
      { id: "sprinkler", label: "Sprinkler", audience: "little" },
    ],
    art: {
      icon: "/art/bake-shop/icon.png",
      cover: "/art/bake-shop/cover.jpg",
      logo: "/art/bake-shop/logo.png",
      heroClean: "/art/bake-shop/hero-clean.jpg",
      theme: "/art/bake-shop/theme.mp3",
      tile: "/art/bake-shop/tv.jpg",
      hero: "/art/bake-shop/alt.jpg",
      safe: { scale: 1.15, ox: 28, oy: 100 },
    },
    shop: { ages: "2+", minutes: [10, 25], players: "2-4" },
  },
  {
    appId: "story-nook",
    name: "Story Nook",
    tagline: "A bedtime pop-up storybook you read together.",
    shape: "couch",
    tv: "required",
    startUrl: workers("story-nook"),
    roles: [
      { id: "grownup", label: "Reader", audience: "grownup" },
      { id: "kid", label: "Kid", audience: "kid" },
      { id: "little", label: "Little one", audience: "little" },
    ],
    art: {
      icon: "/art/story-nook/icon.png",
      cover: "/art/story-nook/cover.jpg",
      logo: "/art/story-nook/logo.png",
      heroClean: "/art/story-nook/hero-clean.jpg",
      theme: "/art/story-nook/theme.mp3",
      tile: "/art/story-nook/tv.jpg",
      hero: "/art/story-nook/journey.jpg",
      safe: { scale: 1.04, ox: 50, oy: 60 },
    },
    shop: { ages: "2+", minutes: [10, 20], players: "2-4" },
  },
  {
    appId: "peekaboo-garden",
    name: "Peekaboo Garden",
    tagline: "Hide-and-seek in a garden: clues on the phone, a magnifier on the iPad.",
    shape: "couch",
    tv: "required",
    startUrl: workers("peekaboo-garden"),
    roles: [
      { id: "grownup", label: "Clue keeper", audience: "grownup" },
      { id: "seeker", label: "Seeker", audience: "kid" },
      { id: "little", label: "Little one", audience: "little" },
    ],
    art: {
      icon: "/art/peekaboo-garden/icon.png",
      cover: "/art/peekaboo-garden/cover.jpg",
      logo: "/art/peekaboo-garden/logo.png",
      heroClean: "/art/peekaboo-garden/hero-clean.jpg",
      theme: "/art/peekaboo-garden/theme.mp3",
      tile: "/art/peekaboo-garden/tv.jpg",
      hero: "/art/peekaboo-garden/tv.jpg",
      safe: { scale: 1.13, ox: 50, oy: 100 },
    },
    shop: { ages: "2+", minutes: [10, 20], players: "2-4" },
  },
  {
    appId: "night-flight",
    name: "Night Flight",
    tagline: "Fly through the night sky together.",
    shape: "couch",
    tv: "required",
    startUrl: workers("night-flight"),
    multiCouch: true,
    roles: [
      { id: "navigator", label: "Navigator", audience: "grownup" },
      { id: "pilot", label: "Pilot", audience: "kid" },
      { id: "little", label: "Little one", audience: "little" },
    ],
    art: {
      icon: "/art/night-flight/icon.png",
      cover: "/art/night-flight/cover.jpg",
      logo: "/art/night-flight/logo.png",
      heroClean: "/art/night-flight/hero-clean.jpg",
      theme: "/art/night-flight/theme.mp3",
      tile: "/art/night-flight/tv.jpg",
      hero: "/art/night-flight/tv.jpg",
      safe: { scale: 1.85, ox: 46, oy: 49 },
    },
    shop: { ages: "3+", minutes: [10, 20], players: "2-4" },
  },
  {
    appId: "trivia-jam",
    name: "Trivia Jam",
    tagline: "Every answer is a number. Closest guess wins, fastest breaks the tie.",
    shape: "couch",
    tv: "required",
    startUrl: "https://triviajam.tv/",
    roles: [
      { id: "host", label: "Quizmaster", audience: "grownup" },
      { id: "player", label: "Player", audience: "grownup" },
    ],
    art: {
      icon: "/art/trivia-jam/icon.png",
      cover: "/art/trivia-jam/cover.jpg",
      logo: "/art/trivia-jam/logo.png",
      heroClean: "/art/trivia-jam/hero-clean.jpg",
      theme: "/art/trivia-jam/theme.mp3",
      tile: "/art/trivia-jam/tv.jpg",
      hero: "/art/trivia-jam/tv.jpg",
    },
    shop: { ages: "12+", minutes: [10, 25], players: "2-10" },
  },
  {
    appId: "codebreakers",
    name: "Codebreakers",
    tagline: "Two expeditions, one vault. One-word clues, twenty-five tablets, one curse.",
    shape: "couch",
    tv: "required",
    startUrl: "https://codebreakers.jonathanrmumm.workers.dev/",
    roles: [
      { id: "keyholder", label: "Keyholder", audience: "grownup" },
      { id: "codebreaker", label: "Codebreaker", audience: "grownup" },
    ],
    art: {
      icon: "/art/codebreakers/icon.png",
      cover: "/art/codebreakers/cover.jpg",
      logo: "/art/codebreakers/logo.png",
      heroClean: "/art/codebreakers/hero-clean.jpg",
      theme: "/art/codebreakers/theme.mp3",
      tile: "/art/codebreakers/tv.jpg",
      hero: "/art/codebreakers/tv.jpg",
    },
    shop: { ages: "12+", minutes: [15, 30], players: "4-8" },
  },
  {
    appId: "little-vigilante",
    name: "Little Vigilante",
    tagline: "One night, secret roles, and a town that has to guess who's behind the mask.",
    shape: "couch",
    tv: "required",
    startUrl: workers("little-vigilante"),
    roles: [
      { id: "host", label: "Host", audience: "grownup" },
      { id: "player", label: "Townsperson", audience: "grownup" },
    ],
    art: {
      icon: "/art/little-vigilante/icon.png",
      cover: "/art/little-vigilante/cover.jpg",
      logo: "/art/little-vigilante/logo.png",
      heroClean: "/art/little-vigilante/hero-clean.jpg",
      theme: "/art/little-vigilante/theme.mp3",
      tile: "/art/little-vigilante/tv.jpg",
      hero: "/art/little-vigilante/tv.jpg",
    },
    shop: { ages: "10+", minutes: [15, 40], players: "4-10" },
  },
  {
    appId: "bobberbrook",
    name: "Bobberbrook",
    tagline:
      "Run around a painted lake together, cast at the swirls and fill the family fish journal.",
    shape: "couch",
    tv: "required",
    startUrl: workers("bobberbrook"),
    roles: [
      { id: "host", label: "Grown-up", audience: "grownup" },
      { id: "fisher", label: "Fisher", audience: "kid" },
      { id: "little", label: "Little fisher", audience: "little" },
    ],
    art: {
      icon: "/art/bobberbrook/icon.png",
      cover: "/art/bobberbrook/cover.jpg",
      logo: "/art/bobberbrook/logo.png",
      heroClean: "/art/bobberbrook/hero-clean.jpg",
      tile: "/art/bobberbrook/tv.jpg",
      hero: "/art/bobberbrook/tv.jpg",
    },
    shop: { ages: "3+", minutes: [10, 40], players: "1-4" },
  },
  {
    appId: "run-set-jimmy",
    name: "Run Set Jimmy",
    tagline: "Seven rounds of runs and sets. Lowest score wins.",
    shape: "couch",
    tv: "required",
    startUrl: workers("run-set-jimmy"),
    multiCouch: true,
    roles: [{ id: "player", label: "Player", audience: "grownup" }],
    art: {
      icon: "/art/run-set-jimmy/icon.png",
      cover: "/art/run-set-jimmy/cover.jpg",
      logo: "/art/run-set-jimmy/logo.png",
      heroClean: "/art/run-set-jimmy/hero-clean.jpg",
      theme: "/art/run-set-jimmy/theme.mp3",
      tile: "/art/run-set-jimmy/tv.jpg",
      hero: "/art/run-set-jimmy/tv.jpg",
    },
    shop: { ages: "10+", minutes: [45, 90], players: "3-7" },
  },
  {
    appId: "settlewood",
    name: "Settlewood",
    tagline: "Settle a living island. Trade wood for sheep. First to ten wins.",
    shape: "couch",
    tv: "required",
    startUrl: workers("settlewood"),
    roles: [{ id: "settler", label: "Settler", audience: "grownup" }],
    art: {
      icon: "/art/settlewood/icon.png",
      cover: "/art/settlewood/cover.jpg",
      logo: "/art/settlewood/logo.png",
      heroClean: "/art/settlewood/hero-clean.jpg",
      tile: "/art/settlewood/tv.jpg",
      hero: "/art/settlewood/tv.jpg",
    },
    shop: { ages: "10+", minutes: [45, 75], players: "2-4" },
  },
  {
    appId: "midnight-museum",
    name: "Midnight Museum",
    tagline:
      "Someone took the Moonstone! Peek in the crates, follow the clues and catch the thief before the doors.",
    shape: "couch",
    tv: "required",
    startUrl: workers("midnight-museum"),
    roles: [
      { id: "detective", label: "Detective", audience: "grownup" },
      { id: "young-detective", label: "Young detective", audience: "kid" },
      { id: "little", label: "Little one", audience: "little" },
    ],
    art: {
      icon: "/art/midnight-museum/icon.png",
      cover: "/art/midnight-museum/cover.jpg",
      logo: "/art/midnight-museum/logo.png",
      heroClean: "/art/midnight-museum/hero-clean.jpg",
      theme: "/art/midnight-museum/theme.mp3",
      tile: "/art/midnight-museum/tv.jpg",
      hero: "/art/midnight-museum/tv.jpg",
    },
    shop: { ages: "5+", minutes: [10, 25], players: "2-4" },
  },
  {
    appId: "pocket-draft",
    name: "Pocket Draft",
    tagline: "Bid on a football team, then watch it play.",
    shape: "async",
    tv: "optional",
    startUrl: "https://pocket-draft-room.jonathanrmumm.workers.dev/",
    multiCouch: true,
    roles: [{ id: "gm", label: "GM", audience: "grownup" }],
    art: {
      icon: "/art/pocket-draft/icon.png",
      cover: "/art/pocket-draft/cover.jpg",
      logo: "/art/pocket-draft/logo.png",
      heroClean: "/art/pocket-draft/hero-clean.jpg",
      theme: "/art/pocket-draft/theme.mp3",
      tile: "/art/pocket-draft/tv.jpg",
      hero: "/art/pocket-draft/tv.jpg",
    },
    shop: { ages: "10+", minutes: [20, 60], players: "2" },
  },
];

export const CATALOGUE: readonly Manifest[] = SEED.map((m) => RoomGameManifestSchema.parse(m));

export const catalogueIds = (): string[] => CATALOGUE.map((m) => m.appId);

export const findManifest = (appId: string): Manifest | undefined =>
  CATALOGUE.find((m) => m.appId === appId);

const StartUrlsSchema = z.record(z.string(), z.string().url());

/**
 * The seed with games' approved catalogue entries (`ogs publish`): a live entry replaces the seed
 * game with its appId in place, or is added after the seed. No live entries: the seed itself.
 */
export function withLiveEntries(
  seed: readonly Manifest[],
  live: readonly Manifest[],
): readonly Manifest[] {
  if (live.length === 0) return seed;
  const byId = new Map(live.map((m) => [m.appId, m]));
  const seedIds = new Set(seed.map((m) => m.appId));
  return [...seed.map((m) => byId.get(m.appId) ?? m), ...live.filter((m) => !seedIds.has(m.appId))];
}

/**
 * The catalogue (the seed plus `live` entries) with local start URLs (`CATALOGUE_START_URLS` = JSON
 * `{ appId: url }`), so a dev stack or an e2e run can open a game served on localhost. Never adds
 * games; a malformed value is ignored. Production leaves it unset.
 */
export function catalogueFor(
  env: { CATALOGUE_START_URLS?: string },
  live: readonly Manifest[] = [],
): readonly Manifest[] {
  const games = withLiveEntries(CATALOGUE, live);
  if (!env.CATALOGUE_START_URLS) return games;
  let raw: unknown;
  try {
    raw = JSON.parse(env.CATALOGUE_START_URLS);
  } catch {
    return games;
  }
  const parsed = StartUrlsSchema.safeParse(raw);
  if (!parsed.success) return games;
  const urls = parsed.data;
  return games.map((m) => (urls[m.appId] ? { ...m, startUrl: urls[m.appId] } : m));
}
