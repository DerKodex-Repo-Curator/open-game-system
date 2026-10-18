import { describe, expect, it } from "vitest";
import { handleFromName, isValidHandle, nextCandidates, normaliseHandle } from "../src/lib/handles";

describe("handles (@id)", () => {
  it.each([
    ["Jonathan Mumm", "jonathan.m"],
    ["Juneau", "juneau"],
    ["  Mom  ", "mom"],
    ["Zoë-Ann!", "zoeann"],
    ["Mary Jo Smith", "mary.s"],
    ["A", "a1"],
    ["!!!", "player"],
    ["", "player"],
    ["Bartholomewbartholomewbart Q", "bartholomewbartholomew.q"],
    ["Bartholomewbartholomewbartholomew", "bartholomewbartholomewba"],
  ])("from the name %j pre-fills %j", (name, handle) => {
    expect(handleFromName(name)).toBe(handle);
    expect(isValidHandle(handleFromName(name))).toBe(true);
  });

  it.each([
    ["@Jonny", "jonny"],
    ["  @@JONATHAN.M ", "jonathan.m"],
    ["juneau", "juneau"],
  ])("normalises %j to %j", (typed, handle) => {
    expect(normaliseHandle(typed)).toBe(handle);
  });

  it.each(["jo", "jonathan.m", "a_b", "x".repeat(24), "9lives"])("accepts %j", (h) => {
    expect(isValidHandle(h)).toBe(true);
  });

  it.each([
    "j",
    "",
    ".jo",
    "_jo",
    "jo n",
    "Jo",
    "jo-n",
    "x".repeat(25),
    "jö",
  ])("refuses %j", (h) => {
    expect(isValidHandle(h)).toBe(false);
  });

  it("suggests the next numbered handles, within 24 characters", () => {
    expect(nextCandidates("jonathan.m", 3)).toEqual(["jonathan.m2", "jonathan.m3", "jonathan.m4"]);
    const long = "x".repeat(24);
    expect(nextCandidates(long, 9).at(-1)).toBe(`${"x".repeat(22)}10`);
    expect(nextCandidates(long, 1)).toEqual([`${"x".repeat(23)}2`]);
  });
});
