import {
  GameNotificationRequestSchema,
  type GameNotificationResult,
  PushConsentRequestSchema,
  type PushConsentResult,
  PushSubscriptionRequestSchema,
} from "@open-game-system/ogs-protocol";
import { type Context, Hono } from "hono";
import { catalogueFor } from "../catalogue";
import { apiError, invalidBody, parseBody } from "../lib/http";
import { deliver, type PushMessage } from "../lib/push-delivery";
import { grantOgs, grantWeb } from "../lib/push-handles";
import { pushSenders } from "../lib/push-senders";
import { vapidKeysFor } from "../lib/vapid-keys";
import { gameKeyAuth } from "../middleware/game-key-auth";
import { anyToken, deviceOnly, type ProfileEnv } from "../middleware/profile-auth";

/** Game pushes (docs/product-specs/push-notifications.md), mounted at /api/v1/games. */
const push = new Hono<ProfileEnv>();

/** The catalogue game, with any local startUrl override (dev stacks and e2e). */
const findGame = (env: { CATALOGUE_START_URLS?: string }, appId: string) =>
  catalogueFor(env).find((m) => m.appId === appId);

/**
 * POST /games/:appId/push-handles — the app's consent sheet said Allow: `{ handle? }` → the handle
 * that reaches this profile in this game. A kid's iPad (a tablet) is always denied.
 */
push.post("/:appId/push-handles", anyToken, deviceOnly, async (c) => {
  const appId = c.req.param("appId") ?? "";
  if (!findGame(c.env, appId)) return apiError(c, 404, "game_not_found", "No game with that appId");
  const body = await parseBody(c, PushConsentRequestSchema);
  if (!body) return invalidBody(c, "handle must be a push handle");
  const claims = c.get("claims");
  if (claims.kind !== "phone") {
    const denied: PushConsentResult = { status: "denied" };
    return c.json(denied);
  }
  const handle = await grantOgs(c.env.DB, claims.sub, appId, Date.now(), body.handle);
  const granted: PushConsentResult = { status: "granted", handle };
  return c.json(granted);
});

/** GET /games/:appId/push-key — the game's VAPID public key (the PWA's applicationServerKey). */
push.get("/:appId/push-key", async (c) => {
  const appId = c.req.param("appId") ?? "";
  if (!findGame(c.env, appId)) return apiError(c, 404, "game_not_found", "No game with that appId");
  const keys = await vapidKeysFor(c.env.DB, appId, c.env.PUSH_KEY_SECRET, Date.now());
  if (!keys) return apiError(c, 503, "web_push_unavailable", "Web push is not configured");
  return c.json({ publicKey: keys.publicKey });
});

/**
 * POST /games/:appId/push-subscriptions — the game's PWA subscribed: `{ subscription, handle? }` →
 * the handle. Only from the game's own origin (its startUrl's).
 */
push.post("/:appId/push-subscriptions", async (c) => {
  const appId = c.req.param("appId") ?? "";
  const game = findGame(c.env, appId);
  if (!game) return apiError(c, 404, "game_not_found", "No game with that appId");
  if (c.req.header("Origin") !== new URL(game.startUrl).origin)
    return apiError(c, 403, "wrong_origin", "Subscriptions come from the game's own site");
  const body = await parseBody(c, PushSubscriptionRequestSchema);
  if (!body)
    return invalidBody(c, "subscription (https endpoint, keys.p256dh, keys.auth) is required");
  const keys = await vapidKeysFor(c.env.DB, appId, c.env.PUSH_KEY_SECRET, Date.now());
  if (!keys) return apiError(c, 503, "web_push_unavailable", "Web push is not configured");
  const { endpoint, keys: k } = body.subscription;
  const handle = await grantWeb(
    c.env.DB,
    appId,
    { endpoint, p256dh: k.p256dh, auth: k.auth },
    keys.publicKey,
    Date.now(),
    body.handle,
  );
  const granted: PushConsentResult = { status: "granted", handle };
  return c.json(granted);
});

/** True when `url` is on the game's origin (the origin of its startUrl). */
const sameOrigin = (url: string, startUrl: string) =>
  new URL(url).origin === new URL(startUrl).origin;

/** The request body as JSON, or undefined when it isn't JSON. */
const jsonBody = (c: Context): Promise<{ raw: unknown } | null> =>
  c.req.json().then(
    (raw: unknown) => ({ raw }),
    () => null,
  );

/** The handles and the checked message, or the error: not JSON, missing fields, a url off the game's origin. */
async function readSend(
  c: Context,
  appId: string,
  startUrl: string,
): Promise<{ to: string[]; message: PushMessage } | Response> {
  const body = await jsonBody(c);
  if (!body) return invalidBody(c, "Request body must be valid JSON");
  const parsed = GameNotificationRequestSchema.safeParse(body.raw);
  if (!parsed.success)
    return apiError(
      c,
      400,
      "missing_fields",
      "to (1-100 push handles), title (≤ 60) and body (≤ 180) are required",
    );
  const { title, body: text, tag, whenOpen } = parsed.data;
  const url = parsed.data.url ?? startUrl;
  if (!sameOrigin(url, startUrl)) return invalidBody(c, "url must be on the game's origin");
  return { to: parsed.data.to, message: { appId, title, body: text, url, tag, whenOpen } };
}

/**
 * POST /games/:appId/notifications — a game server (its API key) tells players something:
 * `{ to: [handle], title, body, url?, tag?, whenOpen? }` → one status per handle, in order.
 */
push.post("/:appId/notifications", gameKeyAuth, async (c) => {
  const appId = c.req.param("appId") ?? "";
  const game = findGame(c.env, appId);
  if (!game) return apiError(c, 404, "unknown_game", "No game with that appId");
  const send = await readSend(c, appId, game.startUrl);
  if (send instanceof Response) return send;
  const senders = pushSenders(c.env, Date.now());
  const results: GameNotificationResult["results"] = [];
  for (const to of send.to)
    results.push({ to, status: await deliver(c.env.DB, to, send.message, senders) });
  const result: GameNotificationResult = { results };
  return c.json(result);
});

export default push;
