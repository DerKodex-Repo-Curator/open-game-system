import {
  CouchInviteResultSchema,
  couchInviteLink,
  RecentPlayersSchema,
} from "@open-game-system/ogs-protocol";
import { Hono } from "hono";
import { z } from "zod";
import { apiError, invalidBody, parseBody } from "../lib/http";
import { pushSenders } from "../lib/push-senders";
import { recentPlayers } from "../lib/recent-players";
import { SESSION_TTL_MS } from "../lib/sessions";
import { emit, versionOf } from "../lib/wide-event";
import { anyToken, deviceOnly, type ProfileEnv } from "../middleware/profile-auth";

// ogs-protocol's CouchInviteBodySchema is zod 3; this route's parser is the API's zod 4.
const BodySchema = z.object({ profileIds: z.array(z.string().min(1)).min(1).max(20) });

const PhoneSchema = z.object({ platform: z.enum(["ios", "android"]), push_token: z.string() });

/**
 * Invite last week's players (docs/acceptance/2026-10-18-second-visit.feature). Mounted at
 * /api/v1/couch. Only to people who shared a couch with the host in the last 7 days, only while
 * the host's couch is on, to their phones (never a tablet), once per person per couch.
 */
const couchInvites = new Hono<ProfileEnv>();

/** GET /recent-players — who shared a couch with me in the last 7 days. */
couchInvites.get("/recent-players", anyToken, deviceOnly, async (c) => {
  const players = await recentPlayers(c.env.DB, c.get("claims").sub, Date.now());
  return c.json(RecentPlayersSchema.parse({ players }));
});

/** POST /invite `{ profileIds }` — push my couch's join link to them. */
couchInvites.post("/invite", anyToken, deviceOnly, async (c) => {
  const body = await parseBody(c, BodySchema);
  if (!body) return invalidBody(c, "profileIds (1 to 20 ids) is required");
  const me = c.get("claims").sub;
  const now = Date.now();
  const couch = await c.env.DB.prepare(
    `SELECT s.id, s.code, p.name FROM couch_sessions s JOIN profiles p ON p.id = s.host_profile_id
     WHERE s.host_profile_id = ? AND s.created_at > ? ORDER BY s.created_at DESC LIMIT 1`,
  )
    .bind(me, now - SESSION_TTL_MS)
    .first<{ id: string; code: string; name: string }>();
  if (!couch) return apiError(c, 409, "not_casting", "Invites go out while your couch is on");

  const allowed = new Set(
    (await recentPlayers(c.env.DB, me, now)).filter((p) => p.reachable).map((p) => p.profileId),
  );
  const senders = pushSenders(c.env, now);
  const url = couchInviteLink(couch.code);
  const invited: string[] = [];
  const skipped: string[] = [];
  for (const id of [...new Set(body.profileIds)]) {
    // Once per person per couch: the insert is the claim (a repeat is ignored).
    const claimed =
      allowed.has(id) &&
      (
        await c.env.DB.prepare(
          "INSERT OR IGNORE INTO couch_invites (session_id, profile_id, sent_at) VALUES (?, ?, ?)",
        )
          .bind(couch.id, id, now)
          .run()
      ).meta.changes === 1;
    if (!claimed) {
      skipped.push(id);
      continue;
    }
    const { results } = await c.env.DB.prepare(
      `SELECT d.platform, d.push_token FROM devices d JOIN profile_devices pd ON pd.device_id = d.ogs_device_id
       WHERE pd.profile_id = ? AND pd.kind = 'phone'`,
    )
      .bind(id)
      .all();
    await Promise.all(
      z
        .array(PhoneSchema)
        .parse(results)
        .map((p) =>
          senders.expo(p.platform, p.push_token, {
            title: `${couch.name}'s couch is on`,
            body: `Tap to join ${couch.name} on the TV.`,
            data: { type: "couch-invite", url },
          }),
        ),
    );
    invited.push(id);
  }
  emit("couch.invite_sent", versionOf(c.env), {
    profile_id: me,
    session_id: couch.id,
    invited: invited.length,
    skipped: skipped.length,
  });
  return c.json(CouchInviteResultSchema.parse({ invited, skipped }));
});

export default couchInvites;
