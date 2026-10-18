import { Hono } from "hono";
import { z } from "zod";
import { areFriends } from "../lib/friends";
import { countFirstSession } from "./family-invites";
import { couchOf, grantFor, playersOf } from "../lib/game-grants";
import { apiError, invalidBody, parseBody } from "../lib/http";
import { issueToken, LAUNCHER_TOKEN_TTL_S } from "../lib/identity";
import { getProfile, isUniqueViolation } from "../lib/profiles";
import {
  findByCode,
  getSession,
  mayEnter,
  newCode,
  normaliseCode,
  SESSION_TTL_MS,
  viewOf,
} from "../lib/sessions";
import { anyToken, deviceOnly, type ProfileEnv } from "../middleware/profile-auth";

const CreateSchema = z.object({
  tvName: z.string().trim().min(1).max(60),
  /** The invite another family this household came through (2026-10-18), if any. */
  invite: z.string().max(64).optional(),
});
const JoinSchema = z.object({
  code: z.string().transform(normaliseCode).pipe(z.string().length(6)),
});

/** Couch sessions: one per cast, owned by the caster. Mounted at /api/v1/sessions. */
const sessions = new Hono<ProfileEnv>();
sessions.use("*", anyToken);

/** POST /sessions — the caster starts a session: its TV code and a 12 h launcher token. */
sessions.post("/", deviceOnly, async (c) => {
  const body = await parseBody(c, CreateSchema);
  if (!body) return invalidBody(c, "tvName is required");
  const db = c.env.DB;
  const hostId = c.get("claims").sub;
  const host = await getProfile(db, hostId);
  if (!host) return apiError(c, 404, "profile_not_found", "Profile not found");
  const sessionId = crypto.randomUUID();
  const code = await insertWithFreeCode(db, sessionId, hostId, body.tvName);
  await countFirstSession(c, body.invite, sessionId);
  const token = await issueToken(
    { sub: hostId, did: `launcher-${crypto.randomUUID()}`, kind: "launcher", sid: sessionId },
    c.env.OGS_JWT_SECRET,
    { now: Date.now(), ttlSeconds: LAUNCHER_TOKEN_TTL_S },
  );
  return c.json({ sessionId, code, tvName: body.tvName, host, token }, 201);
});

/** Inserts the session under a fresh TV code, drawing again (up to 5 codes) while one is in use. */
async function insertWithFreeCode(
  db: D1Database,
  sessionId: string,
  hostId: string,
  tvName: string,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const code = newCode();
    try {
      await db
        .prepare(
          "INSERT INTO couch_sessions (id, host_profile_id, code, tv_name, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(sessionId, hostId, code, tvName, Date.now())
        .run();
      return code;
    } catch (e) {
      if (attempt >= 4 || !isUniqueViolation(e, "code")) throw e;
    }
  }
}

/** POST /sessions/join — join with the TV code; the joiner becomes a member. */
sessions.post("/join", deviceOnly, async (c) => {
  const body = await parseBody(c, JoinSchema);
  if (!body) return invalidBody(c, "code (the 6 characters on the TV) is required");
  const db = c.env.DB;
  const row = await findByCode(db, body.code, Date.now());
  const view = row && (await viewOf(db, row));
  if (!row || !view) return apiError(c, 404, "session_not_found", "No TV has that code");
  await db
    .prepare(
      "INSERT OR IGNORE INTO session_members (session_id, profile_id, joined_at) VALUES (?, ?, ?)",
    )
    .bind(row.id, c.get("claims").sub, Date.now())
    .run();
  return c.json(view);
});

/** POST /sessions/:sid/join — Join a friend's cast (the Join card): the host's friends only. */
sessions.use("/:sid/join", deviceOnly);
sessions.post("/:sid/join", async (c) => {
  const db = c.env.DB;
  const me = c.get("claims").sub;
  const now = Date.now();
  const row = await getSession(db, c.req.param("sid"));
  const view = row && row.created_at > now - SESSION_TTL_MS ? await viewOf(db, row) : null;
  if (!row || !view) return apiError(c, 404, "session_not_found", "Session not found");
  if (!(await mayEnter(db, c.get("claims"), row))) {
    if (!(await areFriends(db, me, row.host_profile_id)))
      return apiError(
        c,
        403,
        "not_a_friend",
        "Only the host's friends can join without the TV code",
      );
    await db
      .prepare(
        "INSERT OR IGNORE INTO session_members (session_id, profile_id, joined_at) VALUES (?, ?, ?)",
      )
      .bind(row.id, me, now)
      .run();
  }
  return c.json(view);
});

/**
 * POST /sessions/:sid/game-token — the launcher's token for the game it frames: `{ appId }` →
 * `{ token, players, expiresAt }` (aud = appId, sid, everyone on the couch; sub = the host).
 */
const GameTokenBody = z.object({ appId: z.string().min(1) });
sessions.post("/:sid/game-token", async (c) => {
  const body = await parseBody(c, GameTokenBody);
  if (!body) return invalidBody(c, "appId is required");
  const db = c.env.DB;
  const row = await getSession(db, c.req.param("sid"));
  if (!row) return apiError(c, 404, "session_not_found", "Session not found");
  if (!(await mayEnter(db, c.get("claims"), row)))
    return apiError(c, 403, "not_a_member", "Join this TV with its code first");
  const couch = await couchOf(db, row.id, row.host_profile_id);
  const host = couch.find((p) => p.id === row.host_profile_id);
  if (!host) return apiError(c, 404, "profile_not_found", "Profile not found");
  const players = playersOf(c.env, couch);
  const grant = await grantFor(
    c,
    body.appId,
    host,
    { sid: row.id, players },
    { sid: row.id, label: host.name },
  );
  if (grant instanceof Response) return grant;
  return c.json({ ...grant, players });
});

/** GET /sessions/:sid — TV name, host and code, for its launcher, its host and its members. */
sessions.get("/:sid", async (c) => {
  const db = c.env.DB;
  const row = await getSession(db, c.req.param("sid"));
  const view = row && (await viewOf(db, row));
  if (!row || !view) return apiError(c, 404, "session_not_found", "Session not found");
  if (!(await mayEnter(db, c.get("claims"), row)))
    return apiError(c, 403, "not_a_member", "Join this TV with its code first");
  return c.json(view);
});

export default sessions;
