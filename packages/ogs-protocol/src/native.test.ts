import { describe, expect, it } from "vitest";
import {
  AccountBridgeEventSchema,
  AccountBridgeStateSchema,
  HapticsBridgeEventSchema,
} from "./native";

describe("haptics bridge events", () => {
  it("accepts IMPACT with a light, medium or heavy style", () => {
    for (const style of ["light", "medium", "heavy"])
      expect(HapticsBridgeEventSchema.safeParse({ type: "IMPACT", style }).success).toBe(true);
  });

  it("accepts NOTIFY with a success, warning or error kind", () => {
    for (const kind of ["success", "warning", "error"])
      expect(HapticsBridgeEventSchema.safeParse({ type: "NOTIFY", kind }).success).toBe(true);
  });

  it("rejects other types, styles and kinds, and missing fields", () => {
    for (const bad of [
      { type: "IMPACT", style: "rigid" },
      { type: "IMPACT" },
      { type: "NOTIFY", kind: "info" },
      { type: "NOTIFY", style: "light" },
      { type: "VIBRATE", ms: 100 },
      { style: "light" },
      null,
      "IMPACT",
    ])
      expect(HapticsBridgeEventSchema.safeParse(bad).success).toBe(false);
  });
});

describe("account bridge store (single-game apps)", () => {
  it("the page asks the app to sign in with SIGN_IN", () => {
    expect(AccountBridgeEventSchema.safeParse({ type: "SIGN_IN" }).success).toBe(true);
    expect(AccountBridgeEventSchema.safeParse({ type: "SIGN_OUT" }).success).toBe(false);
  });

  it("the app says how this device is signed in", () => {
    for (const login of ["none", "guest", "apple", "google"])
      expect(AccountBridgeStateSchema.safeParse({ login, signingIn: false }).success).toBe(true);
    expect(AccountBridgeStateSchema.safeParse({ login: "email", signingIn: false }).success).toBe(
      false,
    );
    expect(AccountBridgeStateSchema.safeParse({ login: "guest" }).success).toBe(false);
  });
});
