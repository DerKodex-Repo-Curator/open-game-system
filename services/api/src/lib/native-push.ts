import { z } from "zod";
import type { PushNotification, PushResult } from "../providers/push";
import { base64url } from "./base64url";
import { type ApnsCredential, apnsSigningKey, type FcmCredential, serviceAccountKey } from "./push-credentials";

/**
 * Sending to a white-label app's devices with that app's own credentials (ADR
 * 2026-10-18-multi-tenant-push): APNs over HTTP/2 with an ES256 provider token, FCM HTTP v1 with an
 * OAuth access token minted from the service account. Workers reach both (checked 2026-10-18).
 */

const text = (v: unknown) => base64url(new TextEncoder().encode(JSON.stringify(v)));

async function signJwt(header: Record<string, string>, claims: Record<string, unknown>, key: CryptoKey, algorithm: Parameters<typeof crypto.subtle.sign>[0]) {
  const input = `${text(header)}.${text(claims)}`;
  const sig = await crypto.subtle.sign(algorithm, key, new TextEncoder().encode(input));
  return `${input}.${base64url(new Uint8Array(sig))}`;
}

/** A cache key that changes with the key itself (a rotated key never reuses the old one's token). */
async function fingerprint(secret: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret))));
}

/** Provider tokens and OAuth tokens, reused within their life (Apple asks for 20-60 min reuse). */
const REUSE_MS = 50 * 60_000;
const cache = new Map<string, { value: string; until: number }>();
async function cached(key: string, now: number, make: () => Promise<string | null>): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.value;
  const value = await make();
  if (value) cache.set(key, { value, until: now + REUSE_MS });
  return value;
}

export async function apnsProviderToken(cred: ApnsCredential, now: number): Promise<string | null> {
  return cached(`apns:${cred.teamId}:${cred.keyId}:${await fingerprint(cred.p8)}`, now, async () => {
    const key = await apnsSigningKey(cred.p8);
    if (!key) return null;
    return signJwt({ alg: "ES256", kid: cred.keyId }, { iss: cred.teamId, iat: Math.floor(now / 1000) }, key, { name: "ECDSA", hash: "SHA-256" });
  });
}

const OAuthSchema = z.object({ access_token: z.string().min(1) });
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export async function fcmAccessToken(cred: FcmCredential, now: number, fetcher: typeof fetch): Promise<string | null> {
  return cached(`fcm:${cred.client_email}:${await fingerprint(cred.private_key)}`, now, async () => {
    const key = await serviceAccountKey(cred.private_key);
    if (!key) return null;
    const iat = Math.floor(now / 1000);
    const assertion = await signJwt(
      { alg: "RS256", typ: "JWT" },
      { iss: cred.client_email, scope: FCM_SCOPE, aud: cred.token_uri, iat, exp: iat + 3600 },
      key,
      "RSASSA-PKCS1-v1_5",
    );
    const res = await fetcher(cred.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    if (!res.ok) return null;
    const parsed = OAuthSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.access_token : null;
  });
}

export type NativeDevice = { platform: "ios"; token: string; apnsEnvironment: "sandbox" | "production"; bundleId: string } | { platform: "android"; token: string };

/** APNs reasons that mean the token is dead for good. */
const APNS_GONE = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

export async function sendApns(cred: ApnsCredential, device: Extract<NativeDevice, { platform: "ios" }>, n: PushNotification, now: number, fetcher: typeof fetch): Promise<PushResult> {
  const jwt = await apnsProviderToken(cred, now);
  if (!jwt) return { success: false, deviceActive: true, error: "apns_key_unusable" };
  const host = device.apnsEnvironment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const res = await fetcher(`https://${host}/3/device/${device.token}`, {
    method: "POST",
    headers: { authorization: `bearer ${jwt}`, "apns-topic": device.bundleId, "apns-push-type": "alert", "apns-priority": "10", "content-type": "application/json" },
    body: JSON.stringify({ aps: { alert: { title: n.title, body: n.body }, sound: "default" }, ogs: n.data ?? {} }),
  });
  if (res.ok) return { success: true, deviceActive: true };
  const reason = z.object({ reason: z.string() }).safeParse(await res.json().catch(() => ({})));
  const gone = res.status === 410 || (reason.success && APNS_GONE.has(reason.data.reason));
  return { success: false, deviceActive: !gone, error: reason.success ? reason.data.reason : `apns_${res.status}` };
}

export async function sendFcm(cred: FcmCredential, device: Extract<NativeDevice, { platform: "android" }>, n: PushNotification, now: number, fetcher: typeof fetch): Promise<PushResult> {
  const token = await fcmAccessToken(cred, now, fetcher);
  if (!token) return { success: false, deviceActive: true, error: "fcm_auth_failed" };
  const res = await fetcher(`https://fcm.googleapis.com/v1/projects/${cred.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { token: device.token, notification: { title: n.title, body: n.body }, data: n.data ?? {}, android: { priority: "high" } } }),
  });
  if (res.ok) return { success: true, deviceActive: true };
  const body = await res.text();
  const gone = res.status === 404 || body.includes("UNREGISTERED");
  return { success: false, deviceActive: !gone, error: `fcm_${res.status}` };
}
