import type { RecentPlayer } from "@open-game-system/ogs-protocol";

/**
 * Invite last week's players (docs/acceptance/2026-10-18-second-visit.feature): one row per person
 * who shared a couch with this host in the last 7 days.
 */
export type InviteRecentRow = {
  profileId: string;
  name: string;
  sticker: string;
  /** invite: tap to send · invited: sent (now or earlier tonight) · unreachable: no phone to notify. */
  state: "invite" | "invited" | "unreachable";
};

export function inviteRecentRows(players: RecentPlayer[], sent: Set<string>): InviteRecentRow[] {
  return players.map((p) => ({
    profileId: p.profileId,
    name: p.name,
    sticker: p.sticker,
    state: !p.reachable ? "unreachable" : sent.has(p.profileId) ? "invited" : "invite",
  }));
}
