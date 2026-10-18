import { describe, expect, it } from "vitest";
import {
  GuestJoinedSchema,
  JOIN_BASE,
  joinLink,
  normaliseTvCode,
  readJoinLink,
  TvCodeSchema,
} from "./join";

// Acceptance: 2026-10-06-join-and-invite.feature, "Home shows the QR next to the TV code" and
// "Scanning with the app installed opens the app".
describe("the join link (the QR on the TV)", () => {
  it("is opengame.org/join/<code>", () => {
    expect(joinLink(JOIN_BASE, "NT9WPH")).toBe("https://opengame.org/join/NT9WPH");
    expect(joinLink("http://localhost:5173///", "NT9WPH")).toBe(
      "http://localhost:5173/join/NT9WPH",
    );
  });

  it.each([
    ["https://opengame.org/join/NT9WPH", "NT9WPH"],
    ["https://opengame.org/join/NT9WPH/", "NT9WPH"],
    ["https://opengame.org/join/nt9wph?utm=tv", "NT9WPH"],
    ["opengame://join/NT9WPH", "NT9WPH"],
    ["opengameapp://join/NT9WPH", "NT9WPH"],
    ["http://localhost:5173/join/KQ7M2X#x", "KQ7M2X"],
  ])("reads %s", (url, code) => {
    expect(readJoinLink(url)).toEqual({ code });
  });

  it.each([
    "https://opengame.org/join/",
    "https://opengame.org/join/NT9WP",
    "https://opengame.org/join/NT9WPHX",
    "https://opengame.org/join/NT9W1H",
    "https://opengame.org/joined/NT9WPH",
    "https://opengame.org/play/night-flight?room=NT9WPH",
    "https://opengame.org/join/NT9WPH/more",
    "see https://opengame.org/join/NT9WPH",
    "not a url",
  ])("ignores %s", (url) => {
    expect(readJoinLink(url)).toBeNull();
  });
});

describe("a TV code", () => {
  it("is what someone typed, upper-cased, without spaces or dashes", () => {
    expect(normaliseTvCode(" nt9-wph ")).toBe("NT9WPH");
  });

  it("is six characters from the TV's alphabet (no 0, O, 1, I or L)", () => {
    expect(TvCodeSchema.safeParse("NT9WPH").success).toBe(true);
    expect(TvCodeSchema.safeParse("nt9wph").success).toBe(false);
    expect(TvCodeSchema.safeParse("NT9WP").success).toBe(false);
    for (const bad of ["NT9WP0", "NT9WPO", "NT9WP1", "NT9WPI", "NT9WPL"])
      expect(TvCodeSchema.safeParse(bad).success).toBe(false);
  });
});

describe("a guest's join answer", () => {
  it("carries a token", () => {
    const ok = { token: "t", sessionId: "s1", code: "NT9WPH", tvName: "TV" };
    expect(GuestJoinedSchema.safeParse(ok).success).toBe(true);
    expect(GuestJoinedSchema.safeParse({ ...ok, token: "" }).success).toBe(false);
  });
});
