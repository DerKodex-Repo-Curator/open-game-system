import { describe, expect, it } from "vitest";
import { FIELD, ROUND_MS, STAR_COUNT, newWorld, step, syncShips } from "./sim";

const seats = [
  { id: "a", name: "Sam", color: "#ffb84d" },
  { id: "b", name: "Ada", color: "#6be3ff" },
];

describe("the comet sim", () => {
  it("starts a round with a ship per seat and a full sky of stars", () => {
    const w = syncShips(newWorld(1, 0), seats);
    expect(Object.keys(w.ships)).toEqual(["a", "b"]);
    expect(w.stars).toHaveLength(STAR_COUNT);
    expect(w.phase).toBe("play");
    expect(w.endsAt).toBe(ROUND_MS);
  });

  it("steers a ship toward its stick and keeps it inside the field", () => {
    let w = syncShips(newWorld(1, 0), seats);
    const startX = w.ships.a?.x ?? 0;
    w = step(w, { a: { x: 1, y: 0 } }, 100, 100).world;
    expect(w.ships.a?.x ?? 0).toBeGreaterThan(startX);
    for (let t = 200; t < 20_000; t += 100) w = step(w, { a: { x: 1, y: -1 } }, 100, t).world;
    expect(w.ships.a?.x).toBeLessThanOrEqual(FIELD.w);
    expect(w.ships.a?.y).toBeGreaterThanOrEqual(0);
  });

  it("scores a caught star and puts a new one in the sky", () => {
    const w0 = syncShips(newWorld(1, 0), seats);
    const star = w0.stars[0];
    if (!star) throw new Error("no star");
    const ship = w0.ships.a;
    if (!ship) throw new Error("no ship");
    const w1 = { ...w0, ships: { ...w0.ships, a: { ...ship, x: star.x, y: star.y } } };
    const { world, caught } = step(w1, {}, 16, 16);
    expect(caught).toEqual([{ id: "a", starId: star.id }]);
    expect(world.ships.a?.score).toBe(1);
    expect(world.stars).toHaveLength(STAR_COUNT);
    expect(world.stars.some((s) => s.id === star.id)).toBe(false);
  });

  it("ends the round on time and starts the next one after a pause, scores reset", () => {
    let w = syncShips(newWorld(1, 0), seats);
    const a = w.ships.a;
    if (!a) throw new Error("no ship");
    w = { ...w, ships: { ...w.ships, a: { ...a, score: 3 } } };
    w = step(w, {}, 16, ROUND_MS + 1).world;
    expect(w.phase).toBe("over");
    expect(w.winner).toBe("a");
    w = step(w, {}, 16, ROUND_MS + 6_000).world;
    expect(w.phase).toBe("play");
    expect(w.round).toBe(2);
    expect(w.ships.a?.score).toBe(0);
  });

  it("holds the clock while nobody is playing", () => {
    const w = step(newWorld(1, 0), {}, 16, 30_000).world;
    expect(w.endsAt).toBe(30_000 + ROUND_MS);
    expect(w.phase).toBe("play");
  });

  it("adds ships for new seats and drops ships whose seat left", () => {
    let w = syncShips(newWorld(1, 0), seats);
    w = syncShips(w, [{ id: "b", name: "Ada", color: "#6be3ff" }]);
    expect(Object.keys(w.ships)).toEqual(["b"]);
  });
});
