import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_GAME_API_KEY } from "./helpers";

describe("Devices & Notifications — D1 Integration", () => {
  beforeEach(async () => {
    // Clean device table between tests
    await env.DB.prepare("DELETE FROM devices").run();
  });

  describe("POST /api/v1/devices/register", () => {
    it("registers a new device and persists in D1", async () => {
      const res = await SELF.fetch("https://api.test/api/v1/devices/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ogsDeviceId: "device-abc123",
          platform: "ios",
          pushToken: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxxx]",
        }),
      });

      expect(res.status).toBe(200);
      // Changed 2026-10-07 (ADR game push and app links): no device token for games any more.
      expect(await res.json()).toEqual({ deviceId: "device-abc123", registered: true });

      // Verify in D1
      const row = await env.DB.prepare("SELECT * FROM devices WHERE ogs_device_id = ?")
        .bind("device-abc123")
        .first();

      expect(row).toBeTruthy();
      expect(row!.platform).toBe("ios");
      expect(row!.push_token).toBe("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxxx]");
    });

    it("updates existing device push token on re-register", async () => {
      // Register first time
      await SELF.fetch("https://api.test/api/v1/devices/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ogsDeviceId: "device-abc123",
          platform: "ios",
          pushToken: "ExponentPushToken[old-token]",
        }),
      });

      // Register again with new token
      const res = await SELF.fetch("https://api.test/api/v1/devices/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ogsDeviceId: "device-abc123",
          platform: "ios",
          pushToken: "ExponentPushToken[new-token]",
        }),
      });

      expect(res.status).toBe(200);

      // Verify the push token was updated
      const row = await env.DB.prepare("SELECT push_token FROM devices WHERE ogs_device_id = ?")
        .bind("device-abc123")
        .first<{ push_token: string }>();

      expect(row?.push_token).toBe("ExponentPushToken[new-token]");
    });

    it("rejects invalid platform", async () => {
      const res = await SELF.fetch("https://api.test/api/v1/devices/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ogsDeviceId: "device-abc123",
          platform: "windows",
          pushToken: "ExponentPushToken[xxx]",
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  // Replaced 2026-10-07: /notifications/send was removed (ADR game push and app links); the same
  // auth checks now run against the game push send route.
  describe("POST /api/v1/games/:appId/notifications", () => {
    const send = (auth?: string) =>
      SELF.fetch("https://api.test/api/v1/games/codebreakers/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
        body: JSON.stringify({
          to: ["ph_doesnotexist000000"],
          title: "Your clue",
          body: "Moon is up.",
        }),
      });

    it("rejects without auth", async () => {
      expect((await send()).status).toBe(401);
    });

    it("rejects with invalid API key", async () => {
      const res = await send("Bearer invalid-key");
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("invalid_api_key");
    });

    it("answers per handle with the game's key", async () => {
      const res = await send(`Bearer ${TEST_GAME_API_KEY}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        results: [{ to: "ph_doesnotexist000000", status: "not_permitted" }],
      });
    });
  });

  describe("D1 schema integrity", () => {
    it("devices table has correct columns", async () => {
      const result = await env.DB.prepare("PRAGMA table_info(devices)").all();

      const columns = result.results.map((r: Record<string, unknown>) => r.name);
      expect(columns).toContain("ogs_device_id");
      expect(columns).toContain("platform");
      expect(columns).toContain("push_token");
      expect(columns).toContain("created_at");
      expect(columns).toContain("updated_at");
    });

    // Changed 2026-10-07: api_keys (plaintext) was replaced by game_api_keys (hashed).
    it("game_api_keys table has correct columns", async () => {
      const result = await env.DB.prepare("PRAGMA table_info(game_api_keys)").all();

      const columns = result.results.map((r: Record<string, unknown>) => r.name);
      expect(columns).toEqual(
        expect.arrayContaining(["id", "app_id", "prefix", "key_hash", "scope", "revoked_at"]),
      );
      expect(columns).not.toContain("key");
    });

    it("test API key is seeded as a hash", async () => {
      const row = await env.DB.prepare("SELECT * FROM game_api_keys WHERE id = 'k-test'").first();

      expect(row).toBeTruthy();
      expect(row!.app_id).toBe("codebreakers");
      expect(row!.key_hash).not.toBe(TEST_GAME_API_KEY);
    });
  });
});
