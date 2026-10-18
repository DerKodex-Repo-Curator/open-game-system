import { z } from "zod";
import { base64url } from "./base64url";

/**
 * Push handles and their surfaces (docs/product-specs/push-notifications.md): one opaque handle per
 * player per game; a surface is where it can be reached (the OGS app for a profile, or a web push
 * subscription). Consent in the app is kept per profile and game in push_grants.
 */

/** `ph_` + 22 random url-safe characters (16 bytes). */
export const newPushHandle = () => `ph_${base64url(crypto.getRandomValues(new Uint8Array(16)))}`;

/** True when the handle exists and belongs to this game. */
export async function handleIsFor(db: D1Database, handle: string, appId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS one FROM push_handles WHERE id = ? AND app_id = ?")
    .bind(handle, appId)
    .first();
  return row !== null;
}

/** The handle that already reaches this profile in this game (its OGS surface), if any. */
async function ogsHandleOf(db: D1Database, profileId: string, appId: string) {
  const row = await db
    .prepare(
      `SELECT h.id FROM push_handles h JOIN push_surfaces s ON s.handle_id = h.id
       WHERE s.kind = 'ogs' AND s.profile_id = ? AND h.app_id = ? ORDER BY h.created_at LIMIT 1`,
    )
    .bind(profileId, appId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** A new, empty handle for the game. */
export async function createHandle(db: D1Database, appId: string, now: number) {
  const id = newPushHandle();
  await db
    .prepare("INSERT INTO push_handles (id, app_id, created_at) VALUES (?, ?, ?)")
    .bind(id, appId, now)
    .run();
  return id;
}

/**
 * The profile allowed the game in the app: records consent and returns the handle that reaches it.
 * `join` (a handle of this game the page already holds, e.g. from its PWA) gains the OGS surface;
 * otherwise the profile's existing handle for the game is reused, or a new one is made.
 */
export async function grantOgs(
  db: D1Database,
  profileId: string,
  appId: string,
  now: number,
  join?: string,
): Promise<string> {
  await db
    .prepare(
      `INSERT INTO push_grants (profile_id, app_id, granted, updated_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(profile_id, app_id) DO UPDATE SET granted = 1, updated_at = excluded.updated_at`,
    )
    .bind(profileId, appId, now)
    .run();
  const joinable = join && (await handleIsFor(db, join, appId)) ? join : null;
  const handle =
    joinable ?? (await ogsHandleOf(db, profileId, appId)) ?? (await createHandle(db, appId, now));
  await db
    .prepare(
      `INSERT INTO push_surfaces (id, handle_id, kind, profile_id, last_active_at, created_at)
       VALUES (?, ?, 'ogs', ?, ?, ?)
       ON CONFLICT(handle_id, profile_id) DO UPDATE SET last_active_at = excluded.last_active_at`,
    )
    .bind(crypto.randomUUID(), handle, profileId, now, now)
    .run();
  return handle;
}

/** Settings: the games this profile allows to notify it (sorted). */
export async function grantedGames(db: D1Database, profileId: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT app_id FROM push_grants WHERE profile_id = ? AND granted = 1 ORDER BY app_id")
    .bind(profileId)
    .all();
  return z
    .array(z.object({ app_id: z.string() }))
    .parse(results)
    .map((r) => r.app_id);
}

/** Settings: the profile turned the game off. */
export function revokeGrant(db: D1Database, profileId: string, appId: string, now: number) {
  return db
    .prepare(
      `INSERT INTO push_grants (profile_id, app_id, granted, updated_at) VALUES (?, ?, 0, ?)
       ON CONFLICT(profile_id, app_id) DO UPDATE SET granted = 0, updated_at = excluded.updated_at`,
    )
    .bind(profileId, appId, now)
    .run();
}

/** The game opened in the app: this profile's OGS surfaces for it become the most recent. */
export function markOgsActive(db: D1Database, profileId: string, appId: string, now: number) {
  return db
    .prepare(
      `UPDATE push_surfaces SET last_active_at = ?
       WHERE kind = 'ogs' AND profile_id = ? AND handle_id IN (SELECT id FROM push_handles WHERE app_id = ?)`,
    )
    .bind(now, profileId, appId)
    .run();
}

/**
 * The game's PWA subscribed (from its own origin): the handle that reaches this subscription. `join`
 * (a handle of this game the page already holds) gains it; otherwise the handle it already had, or a
 * new one. A subscription belongs to one handle: joining moves it.
 */
export async function grantWeb(
  db: D1Database,
  appId: string,
  sub: { endpoint: string; p256dh: string; auth: string },
  vapidPublicKey: string,
  now: number,
  join?: string,
): Promise<string> {
  const joinable = join && (await handleIsFor(db, join, appId)) ? join : null;
  const existing = await db
    .prepare(
      `SELECT s.handle_id AS id FROM push_surfaces s JOIN push_handles h ON h.id = s.handle_id
       WHERE s.endpoint = ? AND h.app_id = ?`,
    )
    .bind(sub.endpoint, appId)
    .first<{ id: string }>();
  const handle = joinable ?? existing?.id ?? (await createHandle(db, appId, now));
  await db.batch([
    db
      .prepare(
        `DELETE FROM push_surfaces WHERE endpoint = ? AND handle_id != ?
         AND handle_id IN (SELECT id FROM push_handles WHERE app_id = ?)`,
      )
      .bind(sub.endpoint, handle, appId),
    db
      .prepare(
        `INSERT INTO push_surfaces (id, handle_id, kind, endpoint, p256dh, auth, vapid_kid, last_active_at, created_at)
         VALUES (?, ?, 'web', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(handle_id, endpoint) DO UPDATE SET
           p256dh = excluded.p256dh, auth = excluded.auth, vapid_kid = excluded.vapid_kid,
           last_active_at = excluded.last_active_at`,
      )
      .bind(
        crypto.randomUUID(),
        handle,
        sub.endpoint,
        sub.p256dh,
        sub.auth,
        vapidPublicKey,
        now,
        now,
      ),
  ]);
  return handle;
}
