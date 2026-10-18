import { getProviderForPlatform } from "../providers/push";
import type { Env } from "../types";
import type { PushSenders } from "./push-delivery";
import { appOf } from "./native-apps";
import { sendApns, sendFcm } from "./native-push";
import { apnsCredential, fcmCredential } from "./push-credentials";
import { vapidKeysFor } from "./vapid-keys";
import { sendWebPush } from "./web-push-sender";

export const DEFAULT_VAPID_SUBJECT = "https://opengame.org";

/**
 * The real senders: Expo for the OGS app, web push with the game's VAPID keys for its PWA, and APNs /
 * FCM with a white-label app's own credentials for that app.
 */
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
    async native(appId, device, n) {
      const secret = env.PUSH_KEY_SECRET;
      if (!secret) return { success: false, deviceActive: true, error: "push_unavailable" };
      if (device.platform === "ios") {
        const [registered, cred] = await Promise.all([appOf(env.DB, appId, "ios"), apnsCredential(env.DB, appId, secret)]);
        if (!cred || registered?.platform !== "ios") return { success: false, deviceActive: true, error: "no_apns_credentials" };
        const apnsEnvironment = device.apns_environment ?? "production";
        return sendApns(cred, { platform: "ios", token: device.token, apnsEnvironment, bundleId: registered.bundleId }, n, now, fetch);
      }
      const cred = await fcmCredential(env.DB, appId, secret);
      if (!cred) return { success: false, deviceActive: true, error: "no_fcm_credentials" };
      return sendFcm(cred, { platform: "android", token: device.token }, n, now, fetch);
    },
  };
}
