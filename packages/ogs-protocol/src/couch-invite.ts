import { z } from "zod";
import { JOIN_BASE, joinLink, normaliseTvCode } from "./join";

/**
 * Invite last week's players (docs/acceptance/2026-10-18-second-visit.feature): while a host's
 * couch is on, OGS pushes its join link to people who shared a couch with the host in the last
 * 7 days (GET /api/v1/couch/recent-players, POST /api/v1/couch/invite).
 */
export const RecentPlayerSchema = z.object({
  profileId: z.string().min(1),
  name: z.string(),
  sticker: z.string(),
  /** A phone OGS can notify (a tablet is a kid's and never is). */
  reachable: z.boolean(),
});
export type RecentPlayer = z.infer<typeof RecentPlayerSchema>;
export const RecentPlayersSchema = z.object({ players: z.array(RecentPlayerSchema) });

export const CouchInviteBodySchema = z.object({
  profileIds: z.array(z.string().min(1)).min(1).max(20),
});
export const CouchInviteResultSchema = z.object({
  invited: z.array(z.string()),
  skipped: z.array(z.string()),
});
export type CouchInviteResult = z.infer<typeof CouchInviteResultSchema>;

/** The couch's join page: what the invite opens. */
export const couchInviteLink = (code: string) => joinLink(JOIN_BASE, normaliseTvCode(code));

/** The push's data: only ever a join page on opengame.org. */
export const CouchInvitePushDataSchema = z.object({
  type: z.literal("couch-invite"),
  url: z
    .string()
    .refine((u) => u.startsWith(`${JOIN_BASE}/join/`) && /\/join\/[A-Z2-9]{6}$/.test(u)),
});
export type CouchInvitePushData = z.infer<typeof CouchInvitePushDataSchema>;
