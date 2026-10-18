import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { qrPath } from "./qr";

/** Paints the path's runs (`M x y h w v1 h-w z`) into an RGBA image, `scale` pixels a module. */
function paint(path: { size: number; d: string }, scale: number) {
  const px = path.size * scale;
  const data = new Uint8ClampedArray(px * px * 4).fill(255);
  for (const m of path.d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let row = y * scale; row < (y + 1) * scale; row++)
      for (let col = x * scale; col < (x + w) * scale; col++)
        data.fill(0, (row * px + col) * 4, (row * px + col) * 4 + 3);
  }
  return { data, px };
}

// The TV's join QR (2026-10-06-join-and-invite.feature): what a phone camera reads must be the link.
describe("the join QR's path", () => {
  it("reads back as the text it encodes", () => {
    for (const text of ["https://opengame.org/join/NT9WPH", "https://opengame.org/join/KQ7M2X"]) {
      const { data, px } = paint(qrPath(text), 6);
      expect(jsQR(data, px, px)?.data).toBe(text);
    }
  });

  it("has a 4-module quiet zone on every side", () => {
    const { size, d } = qrPath("https://opengame.org/join/NT9WPH");
    expect(d).toMatch(/^M\d/);
    const runs = [...d.matchAll(/M(\d+) (\d+)h(\d+)/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
      w: Number(m[3]),
    }));
    expect(Math.min(...runs.map((r) => r.x))).toBe(4);
    expect(Math.min(...runs.map((r) => r.y))).toBe(4);
    expect(Math.max(...runs.map((r) => r.x + r.w))).toBe(size - 4);
    expect(Math.max(...runs.map((r) => r.y + 1))).toBe(size - 4);
  });
});
