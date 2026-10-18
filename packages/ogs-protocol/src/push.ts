import { z } from "zod";

/**
 * Game pushes (spec §9, docs/product-specs/push-notifications.md). A game addresses a player with an
 * opaque push handle, one per player per game; OGS delivers to the OGS app or the game's PWA.
 */

/** `ph_` + 16-64 url-safe characters. Never encodes a device, profile or subscription. */
export const PushHandleSchema = z.string().regex(/^ph_[A-Za-z0-9_-]{16,64}$/);
export type PushHandle = z.infer<typeof PushHandleSchema>;
export const isPushHandle = (value: string) => PushHandleSchema.safeParse(value).success;

/** `deliver`: if the game is open and in front, no banner and the page hears it. `banner`: always show. */
export const WhenOpenSchema = z.enum(["deliver", "banner"]);
export type WhenOpen = z.infer<typeof WhenOpenSchema>;

/** POST /api/v1/games/:appId/notifications, from the game's server with its API key. */
export const GameNotificationRequestSchema = z.object({
  to: z.array(PushHandleSchema).min(1).max(100),
  title: z.string().min(1).max(60),
  body: z.string().min(1).max(180),
  /** Same origin as the game's startUrl; defaults to startUrl. */
  url: z.string().url().optional(),
  /** A later push with the same tag replaces the earlier one on the device. */
  tag: z.string().min(1).max(64).optional(),
  whenOpen: WhenOpenSchema.default("deliver"),
});
export type GameNotificationRequest = z.infer<typeof GameNotificationRequestSchema>;

/**
 * Per handle: `sent` (a surface took it), `not_permitted` (no granted surface, or not this game's
 * handle), `gone` (no surface left: drop the handle), `failed` (every surface errored; try later).
 */
export const PushDeliveryStatusSchema = z.enum(["sent", "not_permitted", "gone", "failed"]);
export type PushDeliveryStatus = z.infer<typeof PushDeliveryStatusSchema>;

export const GameNotificationResultSchema = z.object({
  results: z.array(z.object({ to: z.string(), status: PushDeliveryStatusSchema })),
});
export type GameNotificationResult = z.infer<typeof GameNotificationResultSchema>;

/** Opting in (the app's consent sheet, or a web subscription): a handle, or no. */
export const PushConsentResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("granted"), handle: PushHandleSchema }),
  z.object({ status: z.literal("denied") }),
]);
export type PushConsentResult = z.infer<typeof PushConsentResultSchema>;

/** POST /api/v1/games/:appId/push-handles from the app: optionally join a surface to a handle. */
export const PushConsentRequestSchema = z.object({ handle: PushHandleSchema.optional() });

/** A browser's PushSubscription as JSON (https endpoint, both keys). */
export const WebPushSubscriptionSchema = z.object({
  endpoint: z.string().url().startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
export type WebPushSubscription = z.infer<typeof WebPushSubscriptionSchema>;

/** POST /api/v1/games/:appId/push-subscriptions from the game's own origin. */
export const PushSubscriptionRequestSchema = z.object({
  subscription: WebPushSubscriptionSchema,
  handle: PushHandleSchema.optional(),
});

/** The data a device receives with a game push (Expo `data`, or the web push payload's `data`). */
export const OgsPushDataSchema = z.object({
  type: z.literal("game-push"),
  appId: z.string().min(1),
  url: z.string().url(),
  whenOpen: WhenOpenSchema,
  tag: z.string().optional(),
});
export type OgsPushData = z.infer<typeof OgsPushDataSchema>;

/** A push the page hears while it is open (`onOgsNotification`). */
export const OgsNotificationSchema = z.object({
  title: z.string(),
  body: z.string(),
  url: z.string(),
  tag: z.string().optional(),
});
export type OgsNotification = z.infer<typeof OgsNotificationSchema>;

/** The web push payload OGS encrypts to a subscription; sw.js shows or swallows it. */
export const WebPushPayloadSchema = OgsNotificationSchema.extend({ whenOpen: WhenOpenSchema });
export type WebPushPayload = z.infer<typeof WebPushPayloadSchema>;

/**
 * The app's `notifications` bridge store for a game's WebView. The page asks for consent with
 * `REQUEST` (an id, optionally a handle to join) and the app answers in `state.answer` with that id;
 * the page says whether it handles pushes itself (`LISTENING`). A push swallowed while the game is
 * in front arrives as `state.last`, with a `seq` that only grows.
 */
export const NotificationsBridgeStateSchema = z.object({
  answer: z.object({ id: z.string(), result: PushConsentResultSchema }).nullable(),
  last: z.object({ seq: z.number().int(), notification: OgsNotificationSchema }).nullable(),
});
export type NotificationsBridgeState = z.infer<typeof NotificationsBridgeStateSchema>;

export const NotificationsBridgeEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("REQUEST"),
    id: z.string().min(1),
    handle: PushHandleSchema.optional(),
  }),
  z.object({ type: z.literal("LISTENING"), on: z.boolean() }),
]);
export type NotificationsBridgeEvent = z.infer<typeof NotificationsBridgeEventSchema>;

/** sw.js → an open window of the game: a push it swallowed (the page answers on the port). */
export const ServiceWorkerNotificationMessageSchema = z.object({
  type: z.literal("ogs:notification"),
  notification: OgsNotificationSchema,
});
export type ServiceWorkerNotificationMessage = z.infer<
  typeof ServiceWorkerNotificationMessageSchema
>;
