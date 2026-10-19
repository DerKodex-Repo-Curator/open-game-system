import { z } from "zod";
import { open, seal } from "./secret-box";

/**
 * Each white-label app's push credentials (ADR 2026-10-18-multi-tenant-push), checked on upload
 * (they must import as keys), stored sealed, and opened only to send.
 */
export const ApnsUploadSchema = z.object({
  p8: z.string().min(1).max(4000),
  keyId: z.string().regex(/^[A-Z0-9]{10}$/),
  teamId: z.string().regex(/^[A-Z0-9]{10}$/),
});
export const ServiceAccountSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().min(1).max(100),
  // Any text: storeCredentials checks it imports as a key (invalid_credentials, not invalid_body).
  private_key: z.string().min(1).max(5000),
  client_email: z.email().max(200),
  token_uri: z.url().default("https://oauth2.googleapis.com/token"),
});
export const CredentialsUploadSchema = z.union([
  z.object({ ios: ApnsUploadSchema }).strict(),
  z.object({ android: z.object({ serviceAccount: ServiceAccountSchema }) }).strict(),
]);
export type ServiceAccount = z.infer<typeof ServiceAccountSchema>;

export type ApnsCredential = { keyId: string; teamId: string; p8: string };
export type FcmCredential = ServiceAccount;

/** What each sealed value is bound to: its app and platform (secret-box's context). */
const owner = (appId: string, platform: "ios" | "android") => `${appId}:${platform}`;

const PEM = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/;

/** The DER bytes of a PKCS#8 PEM, or null. */
export function pemBody(pem: string): Uint8Array | null {
  const m = PEM.exec(pem);
  if (!m?.[1]) return null;
  try {
    // Stryker disable next-line Regex: equivalent, /\s/g and /\s+/g both remove every whitespace character
    return Uint8Array.from(atob(m[1].replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function apnsSigningKey(p8: string): Promise<CryptoKey | null> {
  const der = pemBody(p8);
  // Stryker disable next-line ConditionalExpression: equivalent, importKey(null) throws and the catch answers null
  if (!der) return null;
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
  } catch {
    return null;
  }
}

export async function serviceAccountKey(pem: string): Promise<CryptoKey | null> {
  const der = pemBody(pem);
  // Stryker disable next-line ConditionalExpression: equivalent, importKey(null) throws and the catch answers null
  if (!der) return null;
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    return null;
  }
}

/** Stores the app's credential for a platform. False: it isn't a usable key. */
export async function storeCredentials(
  db: D1Database,
  appId: string,
  upload: z.infer<typeof CredentialsUploadSchema>,
  secret: string,
  now: number,
): Promise<boolean> {
  if ("ios" in upload) {
    if (!(await apnsSigningKey(upload.ios.p8))) return false;
    const sealed = await seal(upload.ios.p8, secret, owner(appId, "ios"));
    await db
      .prepare(
        `INSERT INTO app_push_credentials (app_id, platform, key_id, team_id, project_id, client_email, secret_enc, iv, updated_at)
         VALUES (?, 'ios', ?, ?, NULL, NULL, ?, ?, ?)
         ON CONFLICT(app_id, platform) DO UPDATE SET key_id = excluded.key_id, team_id = excluded.team_id,
           secret_enc = excluded.secret_enc, iv = excluded.iv, updated_at = excluded.updated_at`,
      )
      .bind(appId, upload.ios.keyId, upload.ios.teamId, sealed.secretEnc, sealed.iv, now)
      .run();
    return true;
  }
  const sa = upload.android.serviceAccount;
  if (!(await serviceAccountKey(sa.private_key))) return false;
  const sealed = await seal(JSON.stringify(sa), secret, owner(appId, "android"));
  await db
    .prepare(
      `INSERT INTO app_push_credentials (app_id, platform, key_id, team_id, project_id, client_email, secret_enc, iv, updated_at)
       VALUES (?, 'android', NULL, NULL, ?, ?, ?, ?, ?)
       ON CONFLICT(app_id, platform) DO UPDATE SET project_id = excluded.project_id, client_email = excluded.client_email,
         secret_enc = excluded.secret_enc, iv = excluded.iv, updated_at = excluded.updated_at`,
    )
    .bind(appId, sa.project_id, sa.client_email, sealed.secretEnc, sealed.iv, now)
    .run();
  return true;
}

const Row = z.object({
  platform: z.enum(["ios", "android"]),
  key_id: z.string().nullable(),
  team_id: z.string().nullable(),
  project_id: z.string().nullable(),
  client_email: z.string().nullable(),
  secret_enc: z.string(),
  iv: z.string(),
});

/** What's configured for an app, never a secret. */
export async function credentialSummary(db: D1Database, appId: string) {
  const { results } = await db
    .prepare(
      "SELECT platform, key_id, team_id, project_id, client_email, secret_enc, iv FROM app_push_credentials WHERE app_id = ?",
    )
    .bind(appId)
    .all();
  const rows = results.map((r) => Row.parse(r));
  const ios = rows.find((r) => r.platform === "ios");
  const android = rows.find((r) => r.platform === "android");
  return {
    ios: ios
      ? { configured: true as const, keyId: ios.key_id, teamId: ios.team_id }
      : { configured: false as const },
    android: android
      ? {
          configured: true as const,
          projectId: android.project_id,
          clientEmail: android.client_email,
        }
      : { configured: false as const },
  };
}

/** The app's credential for sending, opened. Null: none uploaded. Throws when it won't open (another secret, another app's row). */
export async function apnsCredential(
  db: D1Database,
  appId: string,
  secret: string,
): Promise<ApnsCredential | null> {
  const raw = await db
    .prepare(
      "SELECT platform, key_id, team_id, project_id, client_email, secret_enc, iv FROM app_push_credentials WHERE app_id = ? AND platform = 'ios'",
    )
    .bind(appId)
    .first();
  if (!raw) return null;
  const r = Row.parse(raw);
  return {
    // Stryker disable next-line StringLiteral: equivalent, an ios row always has its key_id (storeCredentials)
    keyId: r.key_id ?? "",
    teamId: r.team_id ?? "",
    p8: await open({ secretEnc: r.secret_enc, iv: r.iv }, secret, owner(appId, "ios")),
  };
}

export async function fcmCredential(
  db: D1Database,
  appId: string,
  secret: string,
): Promise<FcmCredential | null> {
  const raw = await db
    .prepare(
      "SELECT platform, key_id, team_id, project_id, client_email, secret_enc, iv FROM app_push_credentials WHERE app_id = ? AND platform = 'android'",
    )
    .bind(appId)
    .first();
  if (!raw) return null;
  const r = Row.parse(raw);
  return ServiceAccountSchema.parse(
    JSON.parse(await open({ secretEnc: r.secret_enc, iv: r.iv }, secret, owner(appId, "android"))),
  );
}
