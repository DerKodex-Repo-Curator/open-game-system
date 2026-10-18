import type {
  OgsPushData,
  PushDeliveryStatus,
  WebPushPayload,
} from "@open-game-system/ogs-protocol";
import { z } from "zod";
import type { PushNotification, PushResult } from "../providers/push";

/** What a game asked to say, already checked (url resolved to the game's origin). */
export interface PushMessage {
  appId: string;
  title: string;
  body: string;
  url: string;
  tag?: string;
  whenOpen: "deliver" | "banner";
}

export interface WebSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** `ok`: the push service took it. `gone`: the subscription no longer exists (drop it). */
export type WebSendResult = "ok" | "gone" | "error";

/** A device running a game's own white-label app (app_devices). */
export interface AppDeviceRow {
  device_id: string;
  platform: "ios" | "android";
  token: string;
  apns_environment: "sandbox" | "production" | null;
}

/** How OGS reaches each kind of surface; injected so tests (and step 4's web push) can swap them. */
export interface PushSenders {
  expo(platform: "ios" | "android", pushToken: string, n: PushNotification): Promise<PushResult>;
  web(appId: string, sub: WebSubscriptionRow, payload: WebPushPayload): Promise<WebSendResult>;
  /**
   * A game's own white-label app, with that app's credentials (ADR 2026-10-18-multi-tenant-push).
   * Senders without it don't reach white-label apps.
   */
  native?(appId: string, device: AppDeviceRow, n: PushNotification): Promise<PushResult>;
}

const SurfaceRowSchema = z.object({
  id: z.string(),
  kind: z.enum(["ogs", "web"]),
  profile_id: z.string().nullable(),
  endpoint: z.string().nullable(),
  p256dh: z.string().nullable(),
  auth: z.string().nullable(),
});
type SurfaceRow = z.infer<typeof SurfaceRowSchema>;

/** How one surface went: delivered, not allowed, unreachable for good, or a transient error. */
type SurfaceOutcome = "sent" | "not_permitted" | "gone" | "failed";

const DeviceRowSchema = z.object({
  ogs_device_id: z.string(),
  platform: z.enum(["ios", "android"]),
  push_token: z.string(),
});

/** Grown-ups' phones only: a tablet is a kid's iPad, and OGS never pushes to a kid. */
async function phonesOf(db: D1Database, profileId: string) {
  const { results } = await db
    .prepare(
      `SELECT d.ogs_device_id, d.platform, d.push_token FROM devices d
       JOIN profile_devices pd ON pd.device_id = d.ogs_device_id
       WHERE pd.profile_id = ? AND pd.kind = 'phone'`,
    )
    .bind(profileId)
    .all();
  return z.array(DeviceRowSchema).parse(results);
}

const AppDeviceSchema = z.object({
  device_id: z.string(),
  platform: z.enum(["ios", "android"]),
  token: z.string(),
  apns_environment: z.enum(["sandbox", "production"]).nullable(),
});

/** The profile's phones running this game's own app (never another game's app, never a tablet). */
async function appPhonesOf(db: D1Database, profileId: string, appId: string) {
  const { results } = await db
    .prepare(
      `SELECT ad.device_id, ad.platform, ad.token, ad.apns_environment FROM app_devices ad
       JOIN profile_devices pd ON pd.device_id = ad.device_id
       WHERE pd.profile_id = ? AND pd.kind = 'phone' AND ad.app_id = ?`,
    )
    .bind(profileId, appId)
    .all();
  return z.array(AppDeviceSchema).parse(results);
}

async function granted(db: D1Database, profileId: string, appId: string) {
  const row = await db
    .prepare("SELECT granted FROM push_grants WHERE profile_id = ? AND app_id = ?")
    .bind(profileId, appId)
    .first<{ granted: number }>();
  return row?.granted === 1;
}

async function toApp(
  db: D1Database,
  profileId: string,
  m: PushMessage,
  senders: PushSenders,
): Promise<SurfaceOutcome> {
  if (!(await granted(db, profileId, m.appId))) return "not_permitted";
  const phones = await phonesOf(db, profileId);
  const data: OgsPushData = {
    type: "game-push",
    appId: m.appId,
    url: m.url,
    whenOpen: m.whenOpen,
    ...(m.tag ? { tag: m.tag } : {}),
  };
  const n = { title: m.title, body: m.body, data: { ...data } };
  const toOgsApp = phones.map(async (p) => {
    const r = await senders.expo(p.platform, p.push_token, n);
    if (!r.success && !r.deviceActive)
      await db.prepare("DELETE FROM devices WHERE ogs_device_id = ?").bind(p.ogs_device_id).run();
    return r;
  });
  const native = senders.native;
  const toOwnApp = native
    ? (await appPhonesOf(db, profileId, m.appId)).map(async (d) => {
        const r = await native(m.appId, d, n);
        if (!r.success && !r.deviceActive)
          await db.prepare("DELETE FROM app_devices WHERE device_id = ? AND app_id = ?").bind(d.device_id, m.appId).run();
        return r;
      })
    : [];
  const results = await Promise.all([...toOgsApp, ...toOwnApp]);
  if (results.some((r) => r.success)) return "sent";
  return results.some((r) => r.deviceActive) ? "failed" : "gone";
}

const WebKeysSchema = z.object({ endpoint: z.string(), p256dh: z.string(), auth: z.string() });
const WEB_OUTCOME: Record<WebSendResult, SurfaceOutcome> = {
  ok: "sent",
  gone: "gone",
  error: "failed",
};

async function toWeb(
  db: D1Database,
  s: SurfaceRow,
  m: PushMessage,
  senders: PushSenders,
): Promise<SurfaceOutcome> {
  const sub = WebKeysSchema.safeParse(s);
  if (!sub.success) return "gone";
  const payload = {
    title: m.title,
    body: m.body,
    url: m.url,
    whenOpen: m.whenOpen,
    ...(m.tag ? { tag: m.tag } : {}),
  };
  const result = await senders.web(m.appId, sub.data, payload);
  if (result === "gone")
    await db.prepare("DELETE FROM push_surfaces WHERE id = ?").bind(s.id).run();
  return WEB_OUTCOME[result];
}

/** One handle's answer from its surfaces' outcomes: sent beats failed beats gone beats not_permitted. */
export function combine(outcomes: SurfaceOutcome[]): PushDeliveryStatus {
  for (const status of ["sent", "failed", "gone"] as const)
    if (outcomes.includes(status)) return status;
  return "not_permitted";
}

/**
 * Delivers to the handle's last-active surface; when a surface can't take it (not allowed, gone, an
 * error), the next most recent one is tried. Never sends to more than one surface that took it.
 */
export async function deliver(
  db: D1Database,
  handle: string,
  m: PushMessage,
  senders: PushSenders,
): Promise<PushDeliveryStatus> {
  const owner = await db
    .prepare("SELECT app_id FROM push_handles WHERE id = ?")
    .bind(handle)
    .first<{ app_id: string }>();
  if (owner?.app_id !== m.appId) return "not_permitted";
  const { results } = await db
    .prepare(
      `SELECT id, kind, profile_id, endpoint, p256dh, auth FROM push_surfaces
       WHERE handle_id = ? ORDER BY last_active_at DESC, created_at DESC`,
    )
    .bind(handle)
    .all();
  const outcomes: SurfaceOutcome[] = [];
  for (const s of z.array(SurfaceRowSchema).parse(results)) {
    const outcome =
      s.kind === "ogs" && s.profile_id
        ? await toApp(db, s.profile_id, m, senders)
        : await toWeb(db, s, m, senders);
    outcomes.push(outcome);
    if (outcome === "sent") break;
  }
  return combine(outcomes);
}
