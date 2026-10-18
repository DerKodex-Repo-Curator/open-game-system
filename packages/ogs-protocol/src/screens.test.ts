import { describe, expect, it } from "vitest";
import {
  ScreenClaimedSchema,
  ScreenCreatedSchema,
  ScreenShowSchema,
  ScreenStateSchema,
} from "./screens";

// Acceptance: 2026-10-17-browser-tv.feature. The API's answers about browser screens, as every
// side reads them.
describe("browser screen schemas", () => {
  it("a new screen has an id, a TV code and a long secret", () => {
    const ok = { screenId: "sc1", code: "NT9WPH", secret: "s".repeat(43) };
    expect(ScreenCreatedSchema.parse(ok)).toEqual(ok);
    for (const bad of [
      { ...ok, screenId: "" },
      { ...ok, code: "NT9" },
      { ...ok, secret: "s".repeat(31) },
    ])
      expect(ScreenCreatedSchema.safeParse(bad).success).toBe(false);
  });

  it("a screen's state is its code and the launcher token to show, or none", () => {
    expect(ScreenStateSchema.parse({ code: "NT9WPH", show: null })).toEqual({
      code: "NT9WPH",
      show: null,
    });
    expect(ScreenStateSchema.parse({ code: "NT9WPH", show: { token: "lt" } })).toEqual({
      code: "NT9WPH",
      show: { token: "lt" },
    });
    expect(ScreenStateSchema.safeParse({ code: "NT9WPH", show: { token: "" } }).success).toBe(
      false,
    );
    expect(ScreenStateSchema.safeParse({ code: "NT9WPH", show: {} }).success).toBe(false);
    expect(ScreenStateSchema.safeParse({ code: "NOPE", show: null }).success).toBe(false);
  });

  it("a claimed screen has an id and a name; a show carries a token", () => {
    expect(ScreenClaimedSchema.parse({ screenId: "sc1", name: "Browser TV" })).toEqual({
      screenId: "sc1",
      name: "Browser TV",
    });
    expect(ScreenClaimedSchema.safeParse({ screenId: "", name: "Browser TV" }).success).toBe(false);
    expect(ScreenClaimedSchema.safeParse({ name: "Browser TV" }).success).toBe(false);
    expect(ScreenShowSchema.parse({ token: "lt" })).toEqual({ token: "lt" });
    expect(ScreenShowSchema.safeParse({ token: "" }).success).toBe(false);
    expect(ScreenShowSchema.safeParse({}).success).toBe(false);
  });
});
