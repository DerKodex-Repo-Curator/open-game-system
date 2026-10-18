/**
 * Comet Catch, the game itself: every player steers a comet and catches stars. Pure and
 * deterministic, so the TV page runs it and the tests drive it. Replace this file with your game.
 */

export const FIELD = { w: 1600, h: 900 } as const;
export const ROUND_MS = 60_000;
export const BREAK_MS = 5_000;
export const STAR_COUNT = 7;
const SPEED = 0.6; // field units per ms at full stick
const CATCH_R = 48;
const EDGE = 24; // a comet stays whole on screen

export type Stick = { x: number; y: number };
export type Seat = { id: string; name: string; color: string; avatar?: string };
export type Ship = Seat & { x: number; y: number; score: number };
export type Star = { id: number; x: number; y: number };
export type World = {
  seed: number;
  nextStar: number;
  round: number;
  phase: "play" | "over";
  endsAt: number;
  winner: string | null;
  ships: Record<string, Ship>;
  stars: Star[];
};

/** Mulberry32: a tiny seeded random, so a world replays the same. */
function rand(seed: number): [number, number] {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, (seed + 0x6d2b79f5) | 0];
}

function spawnStar(w: World): World {
  const [rx, s1] = rand(w.seed);
  const [ry, s2] = rand(s1);
  const margin = 80;
  const star = {
    id: w.nextStar,
    x: margin + rx * (FIELD.w - 2 * margin),
    y: margin + ry * (FIELD.h - 2 * margin),
  };
  return { ...w, seed: s2, nextStar: w.nextStar + 1, stars: [...w.stars, star] };
}

function fillSky(w: World): World {
  let next = w;
  while (next.stars.length < STAR_COUNT) next = spawnStar(next);
  return next;
}

export function newWorld(seed: number, now: number): World {
  return fillSky({
    seed,
    nextStar: 1,
    round: 1,
    phase: "play",
    endsAt: now + ROUND_MS,
    winner: null,
    ships: {},
    stars: [],
  });
}

/** Ships follow the room's seats: a new seat gets a ship, a seat that left loses it. */
export function syncShips(w: World, seats: Seat[]): World {
  const ships: Record<string, Ship> = {};
  seats.forEach((seat, i) => {
    const had = w.ships[seat.id];
    ships[seat.id] = had
      ? { ...had, ...seat }
      : { ...seat, x: FIELD.w * ((i + 1) / (seats.length + 1)), y: FIELD.h / 2, score: 0 };
  });
  return { ...w, ships };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Advance the world by `dt` ms to time `now`, with each player's stick. */
export function step(
  w: World,
  sticks: Record<string, Stick>,
  dt: number,
  now: number,
): { world: World; caught: { id: string; starId: number }[] } {
  if (w.phase === "over") {
    if (now < w.endsAt + BREAK_MS) return { world: w, caught: [] };
    const ships = Object.fromEntries(
      Object.entries(w.ships).map(([id, s]) => [id, { ...s, score: 0 }]),
    );
    const next = { ...w, ships, round: w.round + 1, phase: "play" as const, winner: null };
    return { world: { ...next, endsAt: now + ROUND_MS }, caught: [] };
  }
  if (Object.keys(w.ships).length === 0)
    return { world: { ...w, endsAt: now + ROUND_MS }, caught: [] };
  if (now >= w.endsAt) {
    const best = Object.values(w.ships).sort((a, b) => b.score - a.score)[0];
    return { world: { ...w, phase: "over", winner: best?.id ?? null }, caught: [] };
  }

  const ships: Record<string, Ship> = {};
  for (const [id, s] of Object.entries(w.ships)) {
    const stick = sticks[id] ?? { x: 0, y: 0 };
    ships[id] = {
      ...s,
      x: clamp(s.x + stick.x * SPEED * dt, EDGE, FIELD.w - EDGE),
      y: clamp(s.y + stick.y * SPEED * dt, EDGE, FIELD.h - EDGE),
    };
  }

  const caught: { id: string; starId: number }[] = [];
  let stars = w.stars;
  for (const ship of Object.values(ships)) {
    const hit = stars.find((st) => Math.hypot(st.x - ship.x, st.y - ship.y) < CATCH_R);
    if (!hit) continue;
    stars = stars.filter((st) => st !== hit);
    ship.score += 1;
    caught.push({ id: ship.id, starId: hit.id });
  }
  return { world: fillSky({ ...w, ships, stars }), caught };
}
