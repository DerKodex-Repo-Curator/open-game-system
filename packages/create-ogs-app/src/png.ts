import { deflateSync } from "node:zlib";
import type { AssetName } from "./plan";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** An 8-bit RGBA PNG from `width × height × 4` bytes (no filtering: the images are flat). */
export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw new Error(`encodePng: ${width}×${height} needs ${expected} bytes, got ${rgba.length}`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function parseHexColor(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m?.[1] || !m[2] || !m[3]) throw new Error(`color must be #rrggbb, got ${hex}`);
  return [Number.parseInt(m[1], 16), Number.parseInt(m[2], 16), Number.parseInt(m[3], 16)];
}

const SIZE = 1024;
const LIGHT: [number, number, number] = [0xf5, 0xf1, 0xe8];
/** A plain ring: a placeholder mark, no faces, nothing that pretends to be the game's art. */
const RING_OUTER = 0.3;
const RING_INNER = 0.2;

/** The placeholder icon (opaque, brand color), adaptive-icon foreground and splash mark. */
export function drawAsset(name: AssetName, brandHex: string): Buffer {
  const brand = Buffer.from([...parseHexColor(brandHex), name === "icon" ? 255 : 0]);
  const light = Buffer.from([...LIGHT, 255]);
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  rgba.fill(brand);
  const c = SIZE / 2;
  const outer = (RING_OUTER * SIZE) ** 2;
  const inner = (RING_INNER * SIZE) ** 2;
  // Per row, the ring is one or two spans of pixels whose centres lie between the two circles.
  const fill = (y: number, from: number, to: number) => {
    if (to >= from) rgba.fill(light, (y * SIZE + from) * 4, (y * SIZE + to + 1) * 4);
  };
  for (let y = 0; y < SIZE; y++) {
    const dy = (y + 0.5 - c) ** 2;
    if (dy > outer) continue;
    const o = Math.sqrt(outer - dy);
    const left = Math.ceil(c - 0.5 - o);
    const right = Math.floor(c - 0.5 + o);
    if (dy >= inner) {
      fill(y, left, right);
      continue;
    }
    const n = Math.sqrt(inner - dy);
    fill(y, left, Math.ceil(c - 0.5 - n) - 1);
    fill(y, Math.floor(c - 0.5 + n) + 1, right);
  }
  return encodePng(SIZE, SIZE, rgba);
}
