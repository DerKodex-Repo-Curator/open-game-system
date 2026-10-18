import { z } from "zod";

/**
 * Invite another family (2026-10-18-invite-another-family.feature): at the end of a session the
 * host sends another household a game link carrying an invite id, so the new household's steps
 * (link opened, TestFlight tapped, first couch) count toward it.
 */

/** An invite id (a UUID the API makes). */
export const InviteIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

/** `<base>/play/<appId>?inv=<inviteId>`: the game link, with the invite. */
export function familyInviteLink(base: string, appId: string, inviteId: string): string {
  return `${base.replace(/\/+$/, "")}/play/${appId}?inv=${inviteId}`;
}

/** POST /api/v1/family-invites `{ appId }` → the new invite and its link. */
export const FamilyInviteSchema = z.object({ inviteId: InviteIdSchema, link: z.string().url() });
export type FamilyInvite = z.infer<typeof FamilyInviteSchema>;

/** GET /api/v1/family-invites/:id → how far the invited household got. */
export const InviteStatsSchema = z.object({
  appId: z.string(),
  opened: z.number().int().nonnegative(),
  testflightTaps: z.number().int().nonnegative(),
  firstSession: z.boolean(),
});
export type InviteStats = z.infer<typeof InviteStatsSchema>;

/** The steps the invite's web page reports (POST /api/v1/family-invites/:id/events `{ step }`). */
export const FunnelStepSchema = z.enum(["link_opened", "testflight_tap"]);
export type FunnelStep = z.infer<typeof FunnelStepSchema>;

type Post = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; keepalive: true },
) => Promise<unknown>;

/**
 * The invite's web page reports a step. keepalive: a TestFlight tap is the page leaving. Never
 * throws: a count lost to a bad connection mustn't stop anyone getting the game.
 */
export async function reportInviteStep(
  api: string,
  inviteId: string,
  step: FunnelStep,
  post: Post,
): Promise<void> {
  try {
    await post(`${api.replace(/\/+$/, "")}/api/v1/family-invites/${inviteId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step }),
      keepalive: true,
    });
  } catch {}
}
