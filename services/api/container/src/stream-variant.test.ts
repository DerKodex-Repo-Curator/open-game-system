import assert from "node:assert/strict";
import { test } from "node:test";
import { streamVariant } from "./stream-variant";

test("no flags: 4 Mbps at 1x, as before", () => {
  assert.deepEqual(streamVariant("https://game.example/tv/ABCD?t=1&stream=1"), {
    maxKbps: 4000,
    scale: 1,
  });
  assert.deepEqual(streamVariant("not a url"), { maxKbps: 4000, scale: 1 });
});

test("ogsStream flags set the bitrate cap and the render scale", () => {
  assert.deepEqual(streamVariant("https://g/tv?ogsStream=kbps6000"), { maxKbps: 6000, scale: 1 });
  assert.deepEqual(streamVariant("https://g/tv?ogsStream=scale2"), { maxKbps: 4000, scale: 2 });
  assert.deepEqual(streamVariant("https://g/tv?stream=1&ogsStream=scale1.5,kbps5000"), {
    maxKbps: 5000,
    scale: 1.5,
  });
});

test("out-of-range or junk flags fall back to the defaults", () => {
  assert.deepEqual(streamVariant("https://g/tv?ogsStream=kbps90000,scale4"), {
    maxKbps: 4000,
    scale: 1,
  });
  assert.deepEqual(streamVariant("https://g/tv?ogsStream=kbpsx,scale"), {
    maxKbps: 4000,
    scale: 1,
  });
});
