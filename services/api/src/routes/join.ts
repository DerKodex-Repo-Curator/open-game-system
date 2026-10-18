import { JoinPreviewSchema, normaliseTvCode, TvCodeSchema } from "@open-game-system/ogs-protocol";
import { Hono } from "hono";
import { apiError } from "../lib/http";
import { getProfile } from "../lib/profiles";
import { findByCode } from "../lib/sessions";
import type { Env } from "../types";

/**
 * The join page's look at a couch (spec ogs-join, opengame.org/join/<code>). No token: the page
 * opens on a phone that may have no OGS profile. Mounted at /api/v1/join.
 */
const join = new Hono<{ Bindings: Env }>();

join.get("/:code", async (c) => {
  const code = TvCodeSchema.safeParse(normaliseTvCode(c.req.param("code")));
  if (!code.success) return apiError(c, 400, "invalid_code", "A TV code is 6 letters and digits");
  const db = c.env.DB;
  const row = await findByCode(db, code.data, Date.now());
  const host = row && (await getProfile(db, row.host_profile_id));
  if (!row || !host) return apiError(c, 404, "session_not_found", "That couch isn't on any more");
  const members = await db
    .prepare(
      `SELECT p.name, p.sticker FROM session_members m JOIN profiles p ON p.id = m.profile_id
       WHERE m.session_id = ? AND m.profile_id != ? ORDER BY m.joined_at`,
    )
    .bind(row.id, row.host_profile_id)
    .all();
  const sitter = { name: host.name, sticker: host.sticker };
  return c.json(
    JoinPreviewSchema.parse({
      code: row.code,
      tvName: row.tv_name,
      host: sitter,
      couch: [sitter, ...members.results],
    }),
  );
});

export default join;
