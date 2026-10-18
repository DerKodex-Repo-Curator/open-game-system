import { z } from "zod";
import type { Inputs } from "../bets";
import type { D1Like } from "./d1";

/** A couch session lives as long as its launcher token (services/api/schema.sql). */
const SESSION_MS = 12 * 3600_000;

const Count = z.object({ n: z.number() });
const Steps = z.object({
  sent: z.number(),
  opened: z.number().nullable(),
  tapped: z.number().nullable(),
  played: z.number().nullable(),
});

/**
 * Bet 1's numbers from opengame-api's own tables (read-only): couch sessions hosted in the window,
 * the ones whose host sent a family invite while the session was live, and how far each invite got.
 */
export async function readFunnel(db: D1Like, from: number, to: number): Promise<Inputs["funnel"]> {
  const sessions = Count.parse(
    await db.prepare("SELECT COUNT(*) AS n FROM couch_sessions WHERE created_at >= ? AND created_at <= ?").bind(from, to).first(),
  ).n;
  const sessionsWithInvite = Count.parse(
    await db
      .prepare(
        `SELECT COUNT(*) AS n FROM couch_sessions s WHERE s.created_at >= ? AND s.created_at <= ? AND EXISTS (
           SELECT 1 FROM family_invites f WHERE f.from_profile_id = s.host_profile_id AND f.created_at >= s.created_at AND f.created_at < s.created_at + ?)`,
      )
      .bind(from, to, SESSION_MS)
      .first(),
  ).n;
  const steps = Steps.parse(
    await db
      .prepare(
        `SELECT COUNT(*) AS sent, SUM(opened > 0) AS opened, SUM(testflight_taps > 0) AS tapped, SUM(first_session_at IS NOT NULL) AS played
         FROM family_invites WHERE created_at >= ? AND created_at <= ?`,
      )
      .bind(from, to)
      .first(),
  );
  return {
    sessions,
    sessionsWithInvite,
    invitesSent: steps.sent,
    linksOpened: steps.opened ?? 0,
    testflightTaps: steps.tapped ?? 0,
    firstSessions: steps.played ?? 0,
  };
}
