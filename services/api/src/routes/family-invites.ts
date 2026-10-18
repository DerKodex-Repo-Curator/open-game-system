import {
  FamilyInviteSchema,
  FunnelStepSchema,
  familyInviteLink,
  InviteIdSchema,
  InviteStatsSchema,
} from "@open-game-system/ogs-protocol";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { findManifest } from "../catalogue";
import { apiError, invalidBody, parseBody } from "../lib/http";
import { emit, versionOf } from "../lib/wide-event";
import { anyToken, deviceOnly, type ProfileEnv } from "../middleware/profile-auth";

/** Where invite links point (the game link on opengame.org). */
const LINK_BASE = "https://opengame.org";

const InviteRowSchema = z.object({
  id: z.string(),
  from_profile_id: z.string(),
  app_id: z.string(),
  opened: z.number(),
  testflight_taps: z.number(),
  first_session_at: z.number().nullable(),
});

const CreateSchema = z.object({ appId: z.string().min(1).max(64) });
// ogs-protocol's FunnelStepSchema is zod 3; this route's parser is the API's zod 4.
const StepSchema = z.object({
  step: z.string().refine((s) => FunnelStepSchema.safeParse(s).success),
});

/** One fixed statement per step (no SQL is built from input). */
const COUNT_STEP = {
  link_opened: "UPDATE family_invites SET opened = opened + 1 WHERE id = ?",
  testflight_tap: "UPDATE family_invites SET testflight_taps = testflight_taps + 1 WHERE id = ?",
} as const;

/**
 * Invite another family (2026-10-18-invite-another-family.feature). Mounted at
 * /api/v1/family-invites. Each step is one wide event, funnel.<step>, with the invite's id.
 */
const familyInvites = new Hono<ProfileEnv>();

/** POST / — the host's phone makes an invite to a game: funnel.invite_sent. */
familyInvites.post("/", anyToken, deviceOnly, async (c) => {
  const body = await parseBody(c, CreateSchema);
  if (!body || !findManifest(body.appId)) return invalidBody(c, "appId (a catalogue game) is required");
  const inviteId = crypto.randomUUID();
  const profileId = c.get("claims").sub;
  await c.env.DB.prepare(
    "INSERT INTO family_invites (id, from_profile_id, app_id, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(inviteId, profileId, body.appId, Date.now())
    .run();
  emit("funnel.invite_sent", versionOf(c.env), {
    invite_id: inviteId,
    profile_id: profileId,
    app_id: body.appId,
  });
  const link = familyInviteLink(LINK_BASE, body.appId, inviteId);
  return c.json(FamilyInviteSchema.parse({ inviteId, link }), 201);
});

/** GET /:id — how far the invited household got (counts only: no one is named). */
familyInvites.get("/:id", async (c) => {
  const row = await inviteOf(c);
  if (row instanceof Response) return row;
  return c.json(
    InviteStatsSchema.parse({
      appId: row.app_id,
      opened: row.opened,
      testflightTaps: row.testflight_taps,
      firstSession: row.first_session_at !== null,
    }),
  );
});

/** POST /:id/events `{ step }` — the invite's web page: link_opened, testflight_tap. No token. */
familyInvites.post("/:id/events", async (c) => {
  const limiter = c.env.CLIENT_EVENTS_LIMITER;
  const key = `invite:${c.req.header("CF-Connecting-IP") ?? "unknown"}`;
  if (limiter && !(await limiter.limit({ key })).success)
    return apiError(c, 429, "rate_limited", "Too many events; try again in a minute");
  const body = await parseBody(c, StepSchema);
  if (!body) return invalidBody(c, "step (link_opened or testflight_tap) is required");
  const row = await inviteOf(c);
  if (row instanceof Response) return row;
  await c.env.DB.prepare(COUNT_STEP[body.step === "link_opened" ? "link_opened" : "testflight_tap"])
    .bind(row.id)
    .run();
  emit(`funnel.${body.step}`, versionOf(c.env), { invite_id: row.id, app_id: row.app_id });
  return c.body(null, 204);
});

async function inviteOf(c: Context<ProfileEnv>) {
  const id = InviteIdSchema.safeParse(c.req.param("id"));
  const row = id.success
    ? await c.env.DB.prepare("SELECT * FROM family_invites WHERE id = ?").bind(id.data).first()
    : null;
  if (!row) return apiError(c, 404, "invite_not_found", "Invite not found");
  return InviteRowSchema.parse(row);
}

/**
 * A new couch's first session counts toward its invite (funnel.first_session): only the invited
 * household's very first couch, once, and never the inviter's own.
 */
export async function countFirstSession(
  c: Context<ProfileEnv>,
  invite: string | undefined,
  sessionId: string,
): Promise<void> {
  const id = InviteIdSchema.safeParse(invite);
  if (!id.success) return;
  const db = c.env.DB;
  const profileId = c.get("claims").sub;
  const before = await db
    .prepare("SELECT COUNT(*) AS n FROM couch_sessions WHERE host_profile_id = ? AND id != ?")
    .bind(profileId, sessionId)
    .first();
  if (z.object({ n: z.number() }).parse(before).n > 0) return;
  const counted = await db
    .prepare(
      `UPDATE family_invites SET first_session_id = ?, first_session_profile_id = ?, first_session_at = ?
       WHERE id = ? AND first_session_at IS NULL AND from_profile_id != ? RETURNING app_id`,
    )
    .bind(sessionId, profileId, Date.now(), id.data, profileId)
    .first();
  if (!counted) return;
  emit("funnel.first_session", versionOf(c.env), {
    invite_id: id.data,
    profile_id: profileId,
    session_id: sessionId,
    app_id: z.object({ app_id: z.string() }).parse(counted).app_id,
  });
}

export default familyInvites;
