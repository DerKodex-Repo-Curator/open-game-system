import { describe, expect, it } from "vitest";
import { percentile, runLoad } from "../src/load";

describe("runLoad: N rooms, a few at a time, every outcome counted", () => {
  it("runs every room in waves of `concurrency` and summarizes the timings", async () => {
    let inFlight = 0;
    let most = 0;
    let n = 0;
    const result = await runLoad({
      rooms: 10,
      concurrency: 4,
      room: async () => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        n++;
        if (n === 3) throw new Error("stuck at seat");
        return { join: n * 10 };
      },
    });
    expect(most).toBe(4);
    expect(result.ok).toBe(9);
    expect(result.failures).toEqual(["Error: stuck at seat"]);
    expect(result.ms.join?.max).toBe(100);
  });
});

describe("percentile", () => {
  it("p50 / p95 / max of a list (rounded)", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 0.5)).toBe(51);
    expect(percentile(xs, 0.95)).toBe(96);
    expect(percentile(xs, 1)).toBe(100);
    expect(percentile([], 0.5)).toBe(0);
  });
});
