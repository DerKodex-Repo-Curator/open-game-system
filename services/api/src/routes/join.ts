import {
  GuestJoinedSchema,
  JoinPreviewSchema,
  normaliseTvCode,
  TvCodeSchema,
} from "@open-game-system/ogs-protocol";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { apiError, invalidBody, parseBody } from "../lib/http";
import { issueToken, LAUNCHER_TOKEN_TTL_S } from "../lib/identity";
import { getProfile } from "../lib/profiles";
import { findByCode, type SessionRow } from "../lib/sessions";
import type { Env } from "../types";

/**
 * The join page's look at a couch (spec ogs-join, opengame.org/join/<code>). No token: the page
 * opens on a phone that may have no OGS profile. Mounted at /api/v1/join.
 */
const join = new Hono<{ Bindings: Env }>();

type JoinContext = Context<{ Bindings: Env }>;

/** The live couch session behind the URL's code, or the error to answer. */
async function couchOf(c: JoinContext): Promise<SessionRow | Response> {
  const code = TvCodeSchema.safeParse(normaliseTvCode(c.req.param("code") ?? ""));
  if (!code.success) return apiError(c, 400, "invalid_code", "A TV code is 6 letters and digits");
  const row = await findByCode(c.env.DB, code.data, Date.now());
  if (!row) return apiError(c, 404, "session_not_found", "That couch isn't on any more");
  return row;
}

join.get("/:code", async (c) => {
  const row = await couchOf(c);
  if (row instanceof Response) return row;
  const db = c.env.DB;
  const host = await getProfile(db, row.host_profile_id);
  if (!host) return apiError(c, 404, "session_not_found", "That couch isn't on any more");
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

const GuestSchema = z.object({
  name: z.string().trim().min(1).max(30),
  // A sticker id (the painted characters), never a URL.
  sticker: z.string().regex(/^[a-z-]{1,40}$/),
});

/**
 * POST /:code/guest — a guest joins from the browser with a name and a sticker (spec ogs-join): a
 * profile for this couch only, a member of it, and a phone token for the browser (it lasts as long
 * as a launcher's). No device, login, @id anyone types, or friends.
 */
join.post("/:code/guest", async (c) => {
  const row = await couchOf(c);
  if (row instanceof Response) return row;
  const body = await parseBody(c, GuestSchema);
  if (!body) return invalidBody(c, "name (1-30 characters) and sticker are required");
  const now = Date.now();
  const profileId = crypto.randomUUID();
  const db = c.env.DB;
  await db.batch([
    db
      .prepare("INSERT INTO profiles (id, handle, name, sticker) VALUES (?, ?, ?, ?)")
      .bind(profileId, `guest.${profileId}`, body.name, body.sticker),
    db
      .prepare("INSERT INTO guest_profiles (profile_id, session_id, created_at) VALUES (?, ?, ?)")
      .bind(profileId, row.id, now),
    db
      .prepare("INSERT INTO session_members (session_id, profile_id, joined_at) VALUES (?, ?, ?)")
      .bind(row.id, profileId, now),
  ]);
  const token = await issueToken(
    { sub: profileId, did: `guest-${crypto.randomUUID()}`, kind: "phone" },
    c.env.OGS_JWT_SECRET,
    { now, ttlSeconds: LAUNCHER_TOKEN_TTL_S },
  );
  return c.json(
    GuestJoinedSchema.parse({ token, sessionId: row.id, code: row.code, tvName: row.tv_name }),
    201,
  );
});

export default join;
