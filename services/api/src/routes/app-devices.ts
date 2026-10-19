import { Hono } from "hono";
import { z } from "zod";
import { apiError, invalidBody, parseBody } from "../lib/http";
import { appOf } from "../lib/native-apps";
import { anyToken, deviceOnly, type ProfileEnv } from "../middleware/profile-auth";

/**
 * PUT /api/v1/apps/:appId/devices/:deviceId — a game's white-label app registers its native push
 * token (APNs device token / FCM registration token) with the profile's device token. The bundle id /
 * package comes from the app's registration (ADR 2026-10-18-multi-tenant-push).
 */
const BodySchema = z.discriminatedUnion("platform", [
  z.object({
    platform: z.literal("ios"),
    token: z.string().regex(/^[0-9a-fA-F]{32,200}$/),
    apnsEnvironment: z.enum(["sandbox", "production"]),
  }),
  z.object({ platform: z.literal("android"), token: z.string().min(1).max(4096) }),
]);

const appDevices = new Hono<ProfileEnv>();

appDevices.put("/:appId/devices/:deviceId", anyToken, deviceOnly, async (c) => {
  // Stryker disable next-line StringLiteral: equivalent, the route always has :appId, so the fallback never runs
  const appId = c.req.param("appId") ?? "";
  // Stryker disable next-line StringLiteral: equivalent, the route always has :deviceId, so the fallback never runs
  const deviceId = c.req.param("deviceId") ?? "";
  if (c.get("claims").did !== deviceId)
    return apiError(c, 403, "not_your_device", "Register a device with its own token");
  const body = await parseBody(c, BodySchema);
  if (!body) return invalidBody(c, "platform, token (and apnsEnvironment on iOS) are required");
  if (!(await appOf(c.env.DB, appId, body.platform)))
    return apiError(
      c,
      409,
      "app_not_registered",
      `No ${body.platform} app is registered for ${appId}`,
    );
  await c.env.DB.prepare(
    `INSERT INTO app_devices (device_id, app_id, platform, token, apns_environment, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id, app_id) DO UPDATE SET platform = excluded.platform, token = excluded.token,
       apns_environment = excluded.apns_environment, updated_at = excluded.updated_at`,
  )
    .bind(
      deviceId,
      appId,
      body.platform,
      body.token,
      body.platform === "ios" ? body.apnsEnvironment : null,
      Date.now(),
    )
    .run();
  return c.body(null, 204);
});

export default appDevices;
