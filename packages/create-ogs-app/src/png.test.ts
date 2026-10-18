import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { drawAsset, encodePng, parseHexColor } from "./png";

/** A tiny PNG reader for the files encodePng writes (8-bit RGBA, filter 0). */
function decode(png: Buffer) {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let at = 8;
  const chunks: { type: string; data: Buffer }[] = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString("ascii");
    chunks.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  const ihdr = chunks[0];
  if (!ihdr || ihdr.type !== "IHDR") throw new Error("no IHDR first");
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const raw = inflateSync(
    Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)),
  );
  const pixel = (x: number, y: number) => {
    const row = y * (width * 4 + 1);
    expect(raw[row]).toBe(0);
    const i = row + 1 + x * 4;
    return [raw[i], raw[i + 1], raw[i + 2], raw[i + 3]];
  };
  return {
    width,
    height,
    bitDepth: ihdr.data[8],
    colorType: ihdr.data[9],
    types: chunks.map((c) => c.type),
    pixel,
    /** Alpha at (x, y), unchecked (fast). */
    alpha: (x: number, y: number) => raw[y * (width * 4 + 1) + 1 + x * 4 + 3],
  };
}

describe("encodePng", () => {
  it("writes a valid 8-bit RGBA PNG", () => {
    const rgba = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128]);
    const png = decode(encodePng(2, 1, rgba));
    expect(png).toMatchObject({ width: 2, height: 1, bitDepth: 8, colorType: 6 });
    expect(png.types).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(png.pixel(0, 0)).toEqual([255, 0, 0, 255]);
    expect(png.pixel(1, 0)).toEqual([0, 255, 0, 128]);
  });

  it("refuses pixels that don't fit the size", () => {
    expect(() => encodePng(2, 2, Buffer.alloc(4))).toThrow(/16/);
  });

  it("has CRCs a strict reader accepts (IEND's is fixed)", () => {
    const png = encodePng(1, 1, Buffer.from([0, 0, 0, 0]));
    expect(png.subarray(-4).toString("hex")).toBe("ae426082");
  });
});

describe("parseHexColor", () => {
  it("reads #rrggbb", () => {
    expect(parseHexColor("#1a2B3c")).toEqual([0x1a, 0x2b, 0x3c]);
  });
  it("refuses anything else", () => {
    expect(() => parseHexColor("red")).toThrow(/#rrggbb/);
  });
});

describe("drawAsset", () => {
  const brand = "#2a5c8a";

  it("the icon is 1024² and opaque, the brand color at the corners, light at the ring", () => {
    const png = decode(drawAsset("icon", brand));
    expect([png.width, png.height]).toEqual([1024, 1024]);
    expect(png.pixel(0, 0)).toEqual([0x2a, 0x5c, 0x8a, 255]);
    expect(png.pixel(1023, 1023)).toEqual([0x2a, 0x5c, 0x8a, 255]);
    const ring = png.pixel(512 + 260, 512);
    expect(ring[3]).toBe(255);
    expect(ring[0]).toBeGreaterThan(200);
    expect(png.pixel(512, 512)).toEqual([0x2a, 0x5c, 0x8a, 255]);
  });

  it("the adaptive icon and splash icon are transparent around the mark", () => {
    for (const name of ["adaptive-icon", "splash-icon"] as const) {
      const png = decode(drawAsset(name, brand));
      expect([png.width, png.height]).toEqual([1024, 1024]);
      expect(png.pixel(0, 0)[3]).toBe(0);
      expect(png.pixel(512, 512)[3]).toBe(0);
    }
  });

  it("the adaptive icon's mark stays inside Android's safe zone (66%)", () => {
    const png = decode(drawAsset("adaptive-icon", brand));
    const safeEdge = Math.floor(1024 * 0.17);
    for (let x = 0; x < safeEdge; x += 8) expect(png.pixel(x, 512)[3]).toBe(0);
  });
});

describe("drawAsset geometry", () => {
  /** The ring by definition: pixel centres between 20% and 30% of the size from the middle. */
  const onRing = (x: number, y: number) => {
    const d = (x + 0.5 - 512) ** 2 + (y + 0.5 - 512) ** 2;
    return d <= (0.3 * 1024) ** 2 && d >= (0.2 * 1024) ** 2;
  };

  it("lights exactly the ring's pixels, every row", () => {
    const png = decode(drawAsset("splash-icon", "#2a5c8a"));
    const wrong: string[] = [];
    for (let y = 0; y < 1024; y += 1) {
      for (let x = 0; x < 1024; x += 1) {
        const lit = png.alpha(x, y) === 255;
        if (lit !== onRing(x, y)) wrong.push(`${x},${y}`);
      }
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(png.pixel(0, 1023)).toEqual([0x2a, 0x5c, 0x8a, 0]);
    expect(png.pixel(512 + 250, 512)).toEqual([0xf5, 0xf1, 0xe8, 255]);
  });

  it("parseHexColor wants the whole string", () => {
    expect(() => parseHexColor("x#112233")).toThrow();
    expect(() => parseHexColor("#112233x")).toThrow();
  });

  it("encodePng copies every row", () => {
    const rgba = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const png = decode(encodePng(1, 2, rgba));
    expect(png.pixel(0, 1)).toEqual([5, 6, 7, 8]);
    expect(() => encodePng(1, 2, Buffer.alloc(9))).toThrow("encodePng: 1×2 needs 8 bytes, got 9");
  });
});
