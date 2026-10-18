import { z } from "zod";
import { nextCandidates } from "./handles";
import { DEVICE_TOKEN_TTL_S, issueToken } from "./identity";

export const ProfileSchema = z.object({
  id: z.string(),
  handle: z.string(),
  name: z.string(),
  sticker: z.string(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProviderSchema = z.enum(["apple", "google", "email"]);
export type Provider = z.infer<typeof ProviderSchema>;
const LoginRowSchema = z.object({ provider: ProviderSchema, email: z.string().nullable() });
export type Login = z.infer<typeof LoginRowSchema>;
export interface Me {
  profile: Profile;
  logins: Login[];
}

export const DeviceSchema = z.object({
  deviceId: z.string().min(1).max(128),
  kind: z.enum(["phone", "tablet"]),
  name: z.string().trim().min(1).max(60),
});
export type Device = z.infer<typeof DeviceSchema>;

export async function getProfile(db: D1Database, id: string): Promise<Profile | null> {
  const row = await db
    .prepare("SELECT id, handle, name, sticker FROM profiles WHERE id = ?")
    .bind(id)
    .first();
  return row ? ProfileSchema.parse(row) : null;
}

/** The profile and its back-up logins (oldest first). */
export async function getMe(db: D1Database, id: string): Promise<Me | null> {
  const profile = await getProfile(db, id);
  if (!profile) return null;
  const { results } = await db
    .prepare("SELECT provider, email FROM profile_logins WHERE profile_id = ? ORDER BY rowid")
    .bind(id)
    .all();
  return { profile, logins: z.array(LoginRowSchema).parse(results) };
}

/** True when no profile other than `except` has the handle. */
export async function isHandleFree(db: D1Database, handle: string, except?: string) {
  const row = await db
    .prepare("SELECT id FROM profiles WHERE handle = ? AND id != ?")
    .bind(handle, except ?? "")
    .first();
  return row === null;
}

/** The handle itself when free, else the first free numbered one (jonathan.m2, …). */
export async function freeHandle(db: D1Database, handle: string): Promise<string> {
  if (await isHandleFree(db, handle)) return handle;
  const candidates = nextCandidates(handle, 50);
  const { results } = await db
    .prepare(
      `SELECT handle FROM profiles WHERE handle IN (${candidates.map(() => "?").join(", ")})`,
    )
    .bind(...candidates)
    .all();
  const taken = new Set(
    z
      .array(z.object({ handle: z.string() }))
      .parse(results)
      .map((r) => r.handle),
  );
  const free = candidates.find((c) => !taken.has(c));
  return (
    free ?? `${handle.slice(0, 18)}${crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000}`
  );
}

/** Puts the device on the profile (one profile per device: signing in elsewhere moves it). */
export function upsertDevice(db: D1Database, profileId: string, device: Device) {
  return db
    .prepare(
      `INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES (?, ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         profile_id = excluded.profile_id, kind = excluded.kind, name = excluded.name`,
    )
    .bind(device.deviceId, profileId, device.kind, device.name);
}

/** A year-long token for the profile on this device. */
export function deviceToken(profileId: string, device: Device, secret: string) {
  return issueToken({ sub: profileId, did: device.deviceId, kind: device.kind }, secret, {
    now: Date.now(),
    ttlSeconds: DEVICE_TOKEN_TTL_S,
  });
}

/** D1 reports a UNIQUE violation as an Error whose message names the constraint. */
export const isUniqueViolation = (e: unknown, column: string) =>
  e instanceof Error && e.message.includes("UNIQUE") && e.message.includes(column);
