import { z } from "zod";
import { base64url } from "./base64url";
import { isUniqueViolation } from "./profiles";
import { newCode } from "./sessions";

/** An unclaimed screen's code works this long (someone is standing at the TV). */
export const SCREEN_PAIR_TTL_MS = 60 * 60 * 1000;
/** A claimed screen stays its phone's TV this long after its last use (a laptop left on HDMI). */
export const SCREEN_CLAIM_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ScreenRowSchema = z.object({
  id: z.string(),
  code: z.string(),
  secret_hash: z.string(),
  owner_profile_id: z.string().nullable(),
  token: z.string().nullable(),
  created_at: z.number(),
  last_used_at: z.number(),
});
export type ScreenRow = z.infer<typeof ScreenRowSchema>;

export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return base64url(new Uint8Array(digest));
}

/** Is this screen still pairable or paired: unclaimed and fresh, or claimed and used lately? */
export const isLive = (row: ScreenRow, now: number) =>
  row.owner_profile_id === null
    ? row.created_at > now - SCREEN_PAIR_TTL_MS
    : row.last_used_at > now - SCREEN_CLAIM_TTL_MS;

/** A new screen under a free code (up to 5 draws): its id, code and secret (kept only hashed). */
export async function createScreen(db: D1Database, now: number) {
  const screenId = crypto.randomUUID();
  const secret = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const secretHash = await hashSecret(secret);
  for (let attempt = 0; ; attempt++) {
    const code = newCode();
    try {
      // A dead screen's code goes back in the pool (its chromeless app first, for the foreign key).
      const dead =
        "code = ? AND ((owner_profile_id IS NULL AND created_at <= ?) OR last_used_at <= ?)";
      const deadOnes = (sql: string) =>
        db.prepare(sql).bind(code, now - SCREEN_PAIR_TTL_MS, now - SCREEN_CLAIM_TTL_MS);
      await db.batch([
        deadOnes(
          `DELETE FROM screen_apps WHERE screen_id IN (SELECT id FROM screens WHERE ${dead})`,
        ),
        deadOnes(`DELETE FROM screens WHERE ${dead}`),
      ]);
      await db
        .prepare(
          "INSERT INTO screens (id, code, secret_hash, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(screenId, code, secretHash, now, now)
        .run();
      return { screenId, code, secret };
    } catch (e) {
      // Stryker disable next-line StringLiteral: equivalent, the only unique column a fresh insert can hit is code
      if (attempt >= 4 || !isUniqueViolation(e, "code")) throw e;
    }
  }
}

export async function getScreen(db: D1Database, id: string): Promise<ScreenRow | null> {
  const row = await db.prepare("SELECT * FROM screens WHERE id = ?").bind(id).first();
  return row ? ScreenRowSchema.parse(row) : null;
}

export async function findScreenByCode(db: D1Database, code: string): Promise<ScreenRow | null> {
  const row = await db.prepare("SELECT * FROM screens WHERE code = ?").bind(code).first();
  return row ? ScreenRowSchema.parse(row) : null;
}
