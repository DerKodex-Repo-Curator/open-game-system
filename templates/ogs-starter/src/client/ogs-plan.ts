import type { OgsProfile, SessionSnapshot } from "@open-game-system/profile-kit";

/**
 * The OGS decisions, as small pure functions so they are tested directly. Everything else in the
 * pages just carries them out.
 */

/** TV: "wait" until profile-kit knows (≤ 300 ms), "own" join UI in a plain browser, "ogs" on the OGS TV. */
export function tvJoinUi(session: SessionSnapshot): "wait" | "own" | "ogs" {
  if (session === undefined) return "wait";
  return session === null ? "own" : "ogs";
}

export type PhonePlan =
  | { kind: "wait" }
  | { kind: "form"; code: string | null }
  | { kind: "go"; room: { make: true } | { code: string }; join: { token: string } };

/**
 * Phone: inside the OGS app, never a form. The phone that starts the game makes the room (and
 * declares its TV page); a phone OGS opens with `ogsRoom` follows the TV into that room. In a plain
 * browser: the game's own name form, and a code field unless the link carried `?room=`.
 */
export function phonePlan(input: {
  profile: OgsProfile | null | undefined;
  ogsRoom: string | null;
  urlRoom: string | null;
  inOgs: boolean;
}): PhonePlan {
  const { profile, ogsRoom, urlRoom, inOgs } = input;
  if (profile === undefined) return { kind: "wait" };
  if (profile === null) return { kind: "form", code: ogsRoom ?? urlRoom };
  const room = ogsRoom ? { code: ogsRoom } : inOgs ? { make: true as const } : null;
  if (!room) return urlRoom ? { kind: "go", room: { code: urlRoom }, join: { token: profile.token } } : { kind: "form", code: null };
  return { kind: "go", room, join: { token: profile.token } };
}
