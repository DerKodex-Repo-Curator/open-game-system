import { buildPushPayload } from "@block65/webcrypto-web-push";
import type { WebPushPayload } from "@open-game-system/ogs-protocol";
import { base64url } from "./base64url";
import type { WebSendResult, WebSubscriptionRow } from "./push-delivery";
import type { VapidKeyPair } from "./vapid-keys";

/** How long a push service keeps an undelivered push (a day: a turn can wait). */
export const WEB_PUSH_TTL_S = 24 * 60 * 60;

/** RFC 8030 topic: at most 32 url-safe base64 characters, so a hash of the tag. */
export async function webPushTopic(tag: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tag));
  return base64url(new Uint8Array(digest)).slice(0, 32);
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** A day to live, normal urgency, and a topic from the tag so a later push replaces this one. */
async function pushOptions(tag: string | undefined) {
  const base = { ttl: WEB_PUSH_TTL_S, urgency: "normal" as const };
  return tag ? { ...base, topic: await webPushTopic(tag) } : base;
}

/** 2xx: the push service took it; 404/410: the subscription is gone; anything else: an error. */
const outcomeOf = (res: Response): WebSendResult => {
  if (res.ok) return "ok";
  return res.status === 404 || res.status === 410 ? "gone" : "error";
};

/**
 * Sends one web push (RFC 8291 aes128gcm, RFC 8292 VAPID) to a subscription with the game's VAPID
 * keys. Never throws: a bad subscription or the network is an `error`.
 */
export async function sendWebPush(
  sub: WebSubscriptionRow,
  payload: WebPushPayload,
  vapid: VapidKeyPair,
  opts: { subject: string; fetch?: Fetch },
): Promise<WebSendResult> {
  const doFetch: Fetch = opts.fetch ?? ((url, init) => fetch(url, init));
  try {
    const request = await buildPushPayload(
      { data: payload, options: await pushOptions(payload.tag) },
      {
        endpoint: sub.endpoint,
        expirationTime: null,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      { subject: opts.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    );
    return outcomeOf(await doFetch(sub.endpoint, request));
  } catch {
    return "error";
  }
}
