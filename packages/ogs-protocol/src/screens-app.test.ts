import { describe, expect, it } from "vitest";
import { ScreenShowSchema, ScreenStateSchema } from "./screens";

// docs/acceptance/2026-10-18-cast-chrome-none.feature: a white-label app's cast to a browser TV is
// chromeless (chrome=none&app=<appId>), so the screen is told the app with the launcher token.
describe("a screen shows a white-label app's launcher chromeless", () => {
  it("show takes the app with the token; without it, as before", () => {
    expect(ScreenShowSchema.parse({ token: "t", app: "rocket-crew" })).toEqual({
      token: "t",
      app: "rocket-crew",
    });
    expect(ScreenShowSchema.parse({ token: "t" })).toEqual({ token: "t" });
  });

  it("refuses an app that isn't a catalogue id", () => {
    for (const app of ["", "Rocket Crew", "a/b", "-x", "x".repeat(65)])
      expect(ScreenShowSchema.safeParse({ token: "t", app }).success).toBe(false);
  });

  it("the screen's state carries the app", () => {
    expect(
      ScreenStateSchema.parse({ code: "KQTP7X", show: { token: "t", app: "rocket-crew" } }),
    ).toEqual({ code: "KQTP7X", show: { token: "t", app: "rocket-crew" } });
    expect(ScreenStateSchema.parse({ code: "KQTP7X", show: { token: "t" } })).toEqual({
      code: "KQTP7X",
      show: { token: "t" },
    });
  });
});
