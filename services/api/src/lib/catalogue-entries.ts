import { type Manifest, ManifestSchema } from "@open-game-system/ogs-protocol";
import { z } from "zod";

/**
 * Games' catalogue entries (table catalogue_entries; docs/design-docs/ogs-cli.md): `ogs publish`
 * submits a manifest as pending, an admin approves it (live) or rejects it with a note.
 */

const RowSchema = z.object({
  app_id: z.string(),
  status: z.enum(["pending", "live", "rejected"]),
  manifest_json: z.string().nullable(),
  pending_json: z.string().nullable(),
  submitted_at: z.number(),
  reviewed_at: z.number().nullable(),
  note: z.string().nullable(),
});

/** A stored manifest, parsed again on the way out (null when absent or no longer valid). */
function manifestOf(json: string | null): Manifest | null {
  if (json === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = ManifestSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type EntryStatus = {
  appId: string;
  status: "pending" | "live" | "rejected" | "none";
  submittedAt?: number;
  reviewedAt?: number;
  note?: string;
  live?: Manifest;
  pending?: Manifest;
};

export async function entryStatus(db: D1Database, appId: string): Promise<EntryStatus> {
  const raw = await db
    .prepare("SELECT * FROM catalogue_entries WHERE app_id = ?")
    .bind(appId)
    .first();
  if (!raw) return { appId, status: "none" };
  const row = RowSchema.parse(raw);
  const live = manifestOf(row.manifest_json);
  const pending = manifestOf(row.pending_json);
  return {
    appId,
    status: row.status,
    submittedAt: row.submitted_at,
    ...(row.reviewed_at === null ? {} : { reviewedAt: row.reviewed_at }),
    ...(row.note === null ? {} : { note: row.note }),
    ...(live ? { live } : {}),
    ...(pending ? { pending } : {}),
  };
}

/** Stores a submission as pending (replacing a pending one); a live manifest stays live. */
export async function submitEntry(db: D1Database, manifest: Manifest, now: number) {
  await db
    .prepare(
      `INSERT INTO catalogue_entries (app_id, status, pending_json, submitted_at)
       VALUES (?, 'pending', ?, ?)
       ON CONFLICT (app_id) DO UPDATE SET
         status = 'pending', pending_json = excluded.pending_json,
         submitted_at = excluded.submitted_at, note = NULL`,
    )
    .bind(manifest.appId, JSON.stringify(manifest), now)
    .run();
}

/** Approves (pending → live) or rejects (pending dropped, note kept) the pending submission. */
export async function reviewEntry(
  db: D1Database,
  appId: string,
  decision: { approve: true } | { approve: false; note: string },
  now: number,
): Promise<boolean> {
  const result = decision.approve
    ? await db
        .prepare(
          `UPDATE catalogue_entries SET status = 'live', manifest_json = pending_json,
             pending_json = NULL, reviewed_at = ?, note = NULL
           WHERE app_id = ? AND pending_json IS NOT NULL`,
        )
        .bind(now, appId)
        .run()
    : await db
        .prepare(
          `UPDATE catalogue_entries SET status = 'rejected', pending_json = NULL, reviewed_at = ?, note = ?
           WHERE app_id = ? AND pending_json IS NOT NULL`,
        )
        .bind(now, decision.note, appId)
        .run();
  return result.meta.changes > 0;
}

/** Every live manifest, in the order the games first submitted. */
export async function liveManifests(db: D1Database): Promise<Manifest[]> {
  const { results } = await db
    .prepare(
      "SELECT manifest_json FROM catalogue_entries WHERE manifest_json IS NOT NULL ORDER BY rowid",
    )
    .all();
  return results
    .map((r) => manifestOf(z.object({ manifest_json: z.string() }).parse(r).manifest_json))
    .filter((m): m is Manifest => m !== null);
}
