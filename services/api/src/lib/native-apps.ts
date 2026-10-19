import { z } from "zod";

/**
 * A game's own App Store / Play Store app (ADR 2026-10-18-multi-tenant-push): registered with the
 * game's API key, one per game per platform; a bundle id / package belongs to one game.
 */
const REVERSE_DNS = /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)+$/;
const ANDROID_PACKAGE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const GOOGLE_CLIENT_ID = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

export const IosAppSchema = z.object({
  bundleId: z.string().max(155).regex(REVERSE_DNS),
  teamId: z.string().regex(/^[A-Z0-9]{10}$/),
});
export const AndroidAppSchema = z.object({
  package: z.string().max(150).regex(ANDROID_PACKAGE),
  sha256CertFingerprints: z.array(z.string().transform((s) => s.toUpperCase()).pipe(z.string().regex(FINGERPRINT))).min(1).max(10),
  googleClientIds: z.array(z.string().regex(GOOGLE_CLIENT_ID)).max(10).default([]),
});
export type IosApp = z.infer<typeof IosAppSchema>;
export type AndroidApp = z.infer<typeof AndroidAppSchema>;

export type NativeApp =
  | ({ appId: string; platform: "ios" } & IosApp)
  | ({ appId: string; platform: "android" } & AndroidApp);

const Row = z.object({
  app_id: z.string(),
  platform: z.enum(["ios", "android"]),
  store_id: z.string(),
  team_id: z.string().nullable(),
  sha256_fingerprints: z.string(),
  google_client_ids: z.string(),
});
const Strings = z.array(z.string());

function fromRow(raw: unknown): NativeApp {
  const r = Row.parse(raw);
  if (r.platform === "ios") return { appId: r.app_id, platform: "ios", bundleId: r.store_id, teamId: r.team_id ?? "" };
  return {
    appId: r.app_id,
    platform: "android",
    package: r.store_id,
    sha256CertFingerprints: Strings.parse(JSON.parse(r.sha256_fingerprints)),
    googleClientIds: Strings.parse(JSON.parse(r.google_client_ids)),
  };
}

const SELECT = "SELECT app_id, platform, store_id, team_id, sha256_fingerprints, google_client_ids FROM native_apps";

/** Registers (or updates) a game's app. "taken": that bundle id / package is another game's. */
export async function registerApp(
  db: D1Database,
  app: NativeApp,
  now: number,
): Promise<{ status: "created" | "updated"; app: NativeApp } | { status: "taken" }> {
  const storeId = app.platform === "ios" ? app.bundleId : app.package;
  const owner = await db
    .prepare("SELECT app_id FROM native_apps WHERE platform = ? AND store_id = ?")
    .bind(app.platform, storeId)
    .first<{ app_id: string }>();
  if (owner && owner.app_id !== app.appId) return { status: "taken" };
  const existing = await db.prepare("SELECT 1 FROM native_apps WHERE app_id = ? AND platform = ?").bind(app.appId, app.platform).first();
  await db
    .prepare(
      `INSERT INTO native_apps (app_id, platform, store_id, team_id, sha256_fingerprints, google_client_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(app_id, platform) DO UPDATE SET store_id = excluded.store_id, team_id = excluded.team_id,
         sha256_fingerprints = excluded.sha256_fingerprints, google_client_ids = excluded.google_client_ids, updated_at = excluded.updated_at`,
    )
    .bind(
      app.appId,
      app.platform,
      storeId,
      app.platform === "ios" ? app.teamId : null,
      JSON.stringify(app.platform === "android" ? app.sha256CertFingerprints : []),
      JSON.stringify(app.platform === "android" ? app.googleClientIds : []),
      now,
      now,
    )
    .run();
  return { status: existing ? "updated" : "created", app };
}

export async function appsOf(db: D1Database, appId: string): Promise<NativeApp[]> {
  const { results } = await db.prepare(`${SELECT} WHERE app_id = ? ORDER BY platform DESC`).bind(appId).all();
  return results.map(fromRow);
}

export async function appOf(db: D1Database, appId: string, platform: "ios" | "android"): Promise<NativeApp | null> {
  const row = await db.prepare(`${SELECT} WHERE app_id = ? AND platform = ?`).bind(appId, platform).first();
  return row ? fromRow(row) : null;
}

export async function allApps(db: D1Database): Promise<NativeApp[]> {
  const { results } = await db.prepare(`${SELECT} ORDER BY app_id, platform DESC`).all();
  return results.map(fromRow);
}

/** opengame.org's link files: every registered app. */
export async function appLinks(db: D1Database) {
  const apps = await allApps(db);
  return {
    ios: apps.flatMap((a) => (a.platform === "ios" ? [{ appId: a.appId, appleAppId: `${a.teamId}.${a.bundleId}` }] : [])),
    android: apps.flatMap((a) =>
      a.platform === "android" ? [{ appId: a.appId, package: a.package, sha256CertFingerprints: a.sha256CertFingerprints }] : [],
    ),
  };
}

/** Sign-in audiences of registered apps: Apple = bundle ids, Google = the apps' OAuth client ids. */
export async function signInAudiences(db: D1Database, provider: "apple" | "google"): Promise<string[]> {
  const apps = await allApps(db);
  return provider === "apple"
    ? apps.flatMap((a) => (a.platform === "ios" ? [a.bundleId] : []))
    : apps.flatMap((a) => (a.platform === "android" ? a.googleClientIds : []));
}
