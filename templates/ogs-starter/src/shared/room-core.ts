import type { Seat } from "./sim";

export const MAX_SEATS = 8;
const COLORS = ["#ffb84d", "#6be3ff", "#ff6f91", "#9dff6b", "#c39bff", "#ffe66b", "#ff9a5c", "#5cffc8"];
/** No I or O: they read as 1 and 0 across a living room. */
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export function newRoomCode(random: () => number = Math.random): string {
  return Array.from({ length: 4 }, () => LETTERS[Math.floor(random() * LETTERS.length)]).join("");
}

/** The claims of a verified OGS game token that a seat needs. */
export type VerifiedPlayer = { sub: string; name: string; avatar: string };

export type SeatResult =
  | { ok: true; seat: Seat; seats: Seat[] }
  | { ok: false; error: "name required" | "room full" };

/**
 * Seat a phone. A verified OGS token wins: its OGS name and avatar, keyed by the OGS profile, so
 * nobody can sit down as someone else. Without one (a plain browser, or a token that failed
 * verification) the player is a guest under the name they typed.
 */
export function seatFor(
  seats: Seat[],
  join: { playerId: string; name?: string },
  verified: VerifiedPlayer | null,
): SeatResult {
  const typed = join.name?.trim() ?? "";
  if (!verified && !typed) return { ok: false, error: "name required" };
  const id = verified ? `ogs:${verified.sub}` : `guest:${join.playerId}`;
  const known = seats.find((s) => s.id === id);
  if (!known && seats.length >= MAX_SEATS) return { ok: false, error: "room full" };
  const color = known?.color ?? COLORS.find((c) => !seats.some((s) => s.color === c)) ?? "#ffffff";
  const seat: Seat = verified
    ? { id, name: verified.name, avatar: verified.avatar, color }
    : { id, name: typed.slice(0, 20), color };
  const next = known ? seats.map((s) => (s.id === id ? seat : s)) : [...seats, seat];
  return { ok: true, seat, seats: next };
}

export function leave(seats: Seat[], id: string): Seat[] {
  return seats.filter((s) => s.id !== id);
}
