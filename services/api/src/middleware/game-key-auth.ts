import type { Context, Next } from "hono";
import { hashApiKey, NOTIFICATIONS_SCOPE } from "../lib/api-keys";
import { apiError } from "../lib/http";
import type { Env } from "../types";

export type GameKeyEnv = { Bindings: Env; Variables: { gameKeyId: string } };

/**
 * A game server's API key (Bearer), looked up by its hash: it must be live, scoped to sending
 * notifications, and belong to the game in the path (`:appId`).
 */
export async function gameKeyAuth(c: Context<GameKeyEnv>, next: Next) {
  const header = c.req.header("Authorization");
  if (!header) return apiError(c, 401, "missing_auth", "Authorization header is required");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match)
    return apiError(c, 401, "invalid_auth", "Authorization header must use Bearer scheme");
  const row = await c.env.DB.prepare(
    `SELECT id, app_id FROM game_api_keys
     WHERE key_hash = ? AND revoked_at IS NULL AND scope = ?`,
  )
    .bind(await hashApiKey(match[1]), NOTIFICATIONS_SCOPE)
    .first<{ id: string; app_id: string }>();
  if (!row) return apiError(c, 401, "invalid_api_key", "The provided API key is invalid");
  if (row.app_id !== c.req.param("appId"))
    return apiError(c, 403, "wrong_game", "This API key belongs to another game");
  c.set("gameKeyId", row.id);
  await next();
}
