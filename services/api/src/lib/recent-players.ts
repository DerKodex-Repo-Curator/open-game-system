import type { RecentPlayer } from "@open-game-system/ogs-protocol";
import { z } from "zod";

/** How far back "last week's players" goes. */
export const RECENT_PLAYERS_MS = 7 * 24 * 60 * 60 * 1000;

const RowSchema = z.object({
  id: z.string(),
  name: z.string(),
  sticker: z.string(),
  last: z.number(),
  reachable: z.number(),
});

/**
 * Who shared a couch with `me` (hosted or joined) since `now - RECENT_PLAYERS_MS`: newest couch
 * first, then by name. Never me, never a browser guest (no phone to reach). `reachable`: a phone
 * with a push token (a tablet is a kid's and is never notified).
 */
export async function recentPlayers(
  db: D1Database,
  me: string,
  now: number,
): Promise<RecentPlayer[]> {
  const { results } = await db
    .prepare(
      `WITH mine AS (
         SELECT s.id, s.created_at FROM couch_sessions s
         WHERE s.created_at >= ?1
           AND (s.host_profile_id = ?2
             OR EXISTS (SELECT 1 FROM session_members m WHERE m.session_id = s.id AND m.profile_id = ?2))
       ),
       together AS (
         SELECT m.profile_id AS pid, mine.created_at AS at FROM session_members m JOIN mine ON mine.id = m.session_id
         UNION ALL
         SELECT s.host_profile_id, mine.created_at FROM couch_sessions s JOIN mine ON mine.id = s.id
       )
       SELECT p.id, p.name, p.sticker, MAX(t.at) AS last,
         EXISTS (SELECT 1 FROM profile_devices pd JOIN devices d ON d.ogs_device_id = pd.device_id
                 WHERE pd.profile_id = p.id AND pd.kind = 'phone') AS reachable
       FROM together t JOIN profiles p ON p.id = t.pid
       WHERE t.pid != ?2 AND t.pid NOT IN (SELECT profile_id FROM guest_profiles)
       GROUP BY p.id
       ORDER BY last DESC, p.name ASC
       LIMIT 20`,
    )
    .bind(now - RECENT_PLAYERS_MS, me)
    .all();
  return z
    .array(RowSchema)
    .parse(results)
    .map((r) => ({
      profileId: r.id,
      name: r.name,
      sticker: r.sticker,
      reachable: r.reachable === 1,
    }));
}
