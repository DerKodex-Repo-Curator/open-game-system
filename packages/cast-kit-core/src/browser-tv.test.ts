import { describe, expect, it } from "vitest";
import { CastDeviceSchema, CastStateSchema } from "./types";

// A white-label app's TVs include browser TVs (2026-10-18-shell-device-gaps.feature).
describe("browser TVs in the cast state", () => {
  it("parses a browser TV device", () => {
    expect(
      CastDeviceSchema.parse({ id: "screen:sc1", name: "Browser TV", type: "browser" }),
    ).toEqual({ id: "screen:sc1", name: "Browser TV", type: "browser" });
  });

  it("parses a shell's state: available with no devices", () => {
    const state = CastStateSchema.parse({
      isAvailable: true,
      devices: [],
      session: {
        status: "disconnected",
        deviceId: null,
        deviceName: null,
        sessionId: null,
        streamSessionId: null,
      },
      error: null,
    });
    expect(state.isAvailable).toBe(true);
  });
});
