import { describe, expect, it } from "vitest";
import { CastDeviceSchema, CastEventsSchema, CastSessionSchema, CastStateSchema } from "./types";

describe("Cast-Kit Core Types (Zod Schemas)", () => {
  describe("CastDeviceSchema", () => {
    it("parses a valid chromecast device", () => {
      const result = CastDeviceSchema.parse({
        id: "living-room-tv",
        name: "Living Room TV",
        type: "chromecast",
      });
      expect(result).toEqual({
        id: "living-room-tv",
        name: "Living Room TV",
        type: "chromecast",
      });
    });

    it("parses a valid airplay device", () => {
      const result = CastDeviceSchema.parse({
        id: "bedroom-apple-tv",
        name: "Bedroom Apple TV",
        type: "airplay",
      });
      expect(result.type).toBe("airplay");
    });

    it("rejects unknown device type", () => {
      expect(() =>
        CastDeviceSchema.parse({
          id: "x",
          name: "X",
          type: "bluetooth",
        }),
      ).toThrow();
    });

    it("rejects missing fields", () => {
      expect(() => CastDeviceSchema.parse({ id: "x" })).toThrow();
    });
  });

  describe("CastStateSchema", () => {
    it("parses a valid initial state", () => {
      const result = CastStateSchema.parse({
        isAvailable: false,
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
      expect(result.isAvailable).toBe(false);
      expect(result.session.status).toBe("disconnected");
    });

    it("parses a connected state with devices", () => {
      const result = CastStateSchema.parse({
        isAvailable: true,
        devices: [{ id: "tv-1", name: "TV 1", type: "chromecast" }],
        session: {
          status: "connected",
          deviceId: "tv-1",
          deviceName: "TV 1",
          sessionId: "session-123",
          streamSessionId: "stream-456",
        },
        error: null,
      });
      expect(result.session.status).toBe("connected");
      expect(result.devices).toHaveLength(1);
    });

    it("parses a state with error", () => {
      const result = CastStateSchema.parse({
        isAvailable: true,
        devices: [],
        session: {
          status: "disconnected",
          deviceId: null,
          deviceName: null,
          sessionId: null,
          streamSessionId: null,
        },
        error: "Stream ended unexpectedly",
      });
      expect(result.error).toBe("Stream ended unexpectedly");
    });

    it("parses a connecting session status", () => {
      const result = CastStateSchema.parse({
        isAvailable: true,
        devices: [],
        session: {
          status: "connecting",
          deviceId: "tv-1",
          deviceName: "Living Room TV",
          sessionId: null,
          streamSessionId: null,
        },
        error: null,
      });
      expect(result.session.status).toBe("connecting");
    });

    it("rejects empty string as session status", () => {
      expect(() =>
        CastStateSchema.parse({
          isAvailable: false,
          devices: [],
          session: {
            status: "",
            deviceId: null,
            deviceName: null,
            sessionId: null,
            streamSessionId: null,
          },
          error: null,
        }),
      ).toThrow();
    });

    it("rejects invalid session status", () => {
      expect(() =>
        CastStateSchema.parse({
          isAvailable: false,
          devices: [],
          session: {
            status: "paused",
            deviceId: null,
            deviceName: null,
            sessionId: null,
            streamSessionId: null,
          },
          error: null,
        }),
      ).toThrow();
    });
  });

  describe("CastEventsSchema", () => {
    it("parses SCAN_DEVICES event", () => {
      const result = CastEventsSchema.parse({ type: "SCAN_DEVICES" });
      expect(result.type).toBe("SCAN_DEVICES");
    });

    it("parses START_CASTING event with deviceId", () => {
      const result = CastEventsSchema.parse({
        type: "START_CASTING",
        deviceId: "tv-1",
      });
      expect(result).toEqual({ type: "START_CASTING", deviceId: "tv-1" });
    });

    it("parses STOP_CASTING event with exact shape", () => {
      const result = CastEventsSchema.parse({ type: "STOP_CASTING" });
      expect(result).toEqual({ type: "STOP_CASTING" });
    });

    it("parses SEND_STATE_UPDATE event preserving payload", () => {
      const payload = { question: "What year?", round: 3 };
      const result = CastEventsSchema.parse({
        type: "SEND_STATE_UPDATE",
        payload,
      });
      expect(result).toEqual({ type: "SEND_STATE_UPDATE", payload });
    });

    it("parses SHOW_CAST_PICKER event with exact shape", () => {
      const result = CastEventsSchema.parse({ type: "SHOW_CAST_PICKER" });
      expect(result).toEqual({ type: "SHOW_CAST_PICKER" });
    });

    it("parses RESET_ERROR event with exact shape", () => {
      const result = CastEventsSchema.parse({ type: "RESET_ERROR" });
      expect(result).toEqual({ type: "RESET_ERROR" });
    });

    it("parses SCAN_DEVICES event with exact shape", () => {
      const result = CastEventsSchema.parse({ type: "SCAN_DEVICES" });
      expect(result).toEqual({ type: "SCAN_DEVICES" });
    });

    it("rejects unknown event type", () => {
      expect(() => CastEventsSchema.parse({ type: "UNKNOWN_EVENT" })).toThrow();
    });

    it("rejects START_CASTING without deviceId", () => {
      expect(() => CastEventsSchema.parse({ type: "START_CASTING" })).toThrow();
    });

    it("rejects event without type field", () => {
      expect(() => CastEventsSchema.parse({})).toThrow();
    });

    it("rejects event with empty string type", () => {
      expect(() => CastEventsSchema.parse({ type: "" })).toThrow();
    });

    it("preserves SEND_STATE_UPDATE payload data", () => {
      const payload = { question: "What year?", round: 3 };
      const result = CastEventsSchema.parse({
        type: "SEND_STATE_UPDATE",
        payload,
      });
      expect(result).toHaveProperty("payload");
      expect((result as any).payload).toEqual(payload);
    });

    it("preserves START_CASTING deviceId value", () => {
      const result = CastEventsSchema.parse({
        type: "START_CASTING",
        deviceId: "specific-device-123",
      });
      expect(result).toHaveProperty("deviceId");
      expect((result as any).deviceId).toBe("specific-device-123");
    });
  });

  describe("CastSessionSchema", () => {
    it("parses a valid disconnected session", () => {
      const result = CastSessionSchema.parse({
        status: "disconnected",
        deviceId: null,
        deviceName: null,
        sessionId: null,
        streamSessionId: null,
      });
      expect(result.status).toBe("disconnected");
    });

    it("parses a valid connecting session", () => {
      const result = CastSessionSchema.parse({
        status: "connecting",
        deviceId: "tv-1",
        deviceName: "TV",
        sessionId: null,
        streamSessionId: null,
      });
      expect(result.status).toBe("connecting");
      expect(result.deviceId).toBe("tv-1");
    });

    it("parses a valid connected session", () => {
      const result = CastSessionSchema.parse({
        status: "connected",
        deviceId: "tv-1",
        deviceName: "TV",
        sessionId: "sess-1",
        streamSessionId: "stream-1",
      });
      expect(result.status).toBe("connected");
      expect(result.sessionId).toBe("sess-1");
      expect(result.streamSessionId).toBe("stream-1");
    });

    it("rejects missing status field", () => {
      expect(() =>
        CastSessionSchema.parse({
          deviceId: null,
          deviceName: null,
          sessionId: null,
          streamSessionId: null,
        }),
      ).toThrow();
    });
  });
});

describe("view URL (what the TV shows)", () => {
  it("accepts SET_VIEW_URL with an https URL", () => {
    expect(CastEventsSchema.safeParse({ type: "SET_VIEW_URL", url: "https://game.example/tv/ABCD" }).success).toBe(true);
  });

  it("rejects SET_VIEW_URL with a non-URL", () => {
    expect(CastEventsSchema.safeParse({ type: "SET_VIEW_URL", url: "not a url" }).success).toBe(false);
  });

  it("keeps viewUrl in cast state (null until the game sets one)", () => {
    const base = { isAvailable: false, devices: [], session: { status: "disconnected", deviceId: null, deviceName: null, sessionId: null, streamSessionId: null }, error: null };
    expect(CastStateSchema.safeParse({ ...base, viewUrl: null }).success).toBe(true);
    expect(CastStateSchema.safeParse({ ...base, viewUrl: "https://game.example/tv" }).success).toBe(true);
  });
});
