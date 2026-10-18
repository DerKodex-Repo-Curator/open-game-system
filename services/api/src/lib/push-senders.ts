import { getProviderForPlatform } from "../providers/push";
import type { Env } from "../types";
import type { PushSenders } from "./push-delivery";
import { vapidKeysFor } from "./vapid-keys";
import { sendWebPush } from "./web-push-sender";

export const DEFAULT_VAPID_SUBJECT = "https://opengame.org";

/** The real senders: Expo for the OGS app, web push with the game's VAPID keys for its PWA. */
export function pushSenders(
  env: Pick<Env, "DB" | "PUSH_KEY_SECRET" | "PUSH_VAPID_SUBJECT" | "EXPO_ACCESS_TOKEN">,
  now: number,
): PushSenders {
  return {
    expo: (platform, token, n) =>
      getProviderForPlatform(platform, env.EXPO_ACCESS_TOKEN).send(token, n),
    async web(appId, sub, payload) {
      const vapid = await vapidKeysFor(env.DB, appId, env.PUSH_KEY_SECRET, now);
      if (!vapid) return "error";
      return sendWebPush(sub, payload, vapid, {
        subject: env.PUSH_VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT,
      });
    },
  };
}
