import { z } from "zod";
import { type GuestJoined, GuestJoinedSchema, normaliseTvCode } from "./join";
import { roomStartUrl } from "./rooms";
import type { FollowTarget } from "./session";

/**
 * A guest from the browser (spec ogs-join, "Guests from the browser"): no app, a name and a
 * sticker, on the couch with a phone token; the browser is the remote and follows the TV.
 */

/** The painted characters a guest picks from (the app's stickers). */
export const GUEST_STICKERS = [
  "bear",
  "owl",
  "dragon",
  "dinosaur",
  "turtle",
  "whale",
  "firefly",
  "mouse",
  "cloud",
] as const;

export type GuestJoin =
  | { kind: "joined"; joined: GuestJoined }
  | { kind: "gone" }
  | { kind: "bad" }
  | { kind: "offline" };

type Reply = { status: number; ok: boolean; json(): Promise<unknown> };
type FetchLike = (
  url: string,
  init?: { method: string; headers: Record<string, string>; body: string },
) => Promise<Reply>;

/** POST /api/v1/join/:code/guest, parsed at the edge. */
export async function joinAsGuest(
  api: string,
  code: string,
  input: { name: string; sticker: string },
  fetch: FetchLike,
): Promise<GuestJoin> {
  const name = input.name.trim();
  if (!name) return { kind: "bad" };
  try {
    const res = await fetch(
      `${api.replace(/\/+$/, "")}/api/v1/join/${normaliseTvCode(code)}/guest`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, sticker: input.sticker }),
      },
    );
    if (res.status === 404) return { kind: "gone" };
    if (res.status === 400) return { kind: "bad" };
    if (!res.ok) return { kind: "offline" };
    const joined = GuestJoinedSchema.safeParse(await res.json());
    return joined.success ? { kind: "joined", joined: joined.data } : { kind: "offline" };
  } catch {
    return { kind: "offline" };
  }
}

/** What a guest's browser shows: the remote, a game's phone page, or the same as now (waiting). */
export type GuestScreen =
  | { kind: "remote" }
  | { kind: "game"; appId: string; url: string }
  | { kind: "wait" };

/**
 * Where the guest's browser goes when the couch session says follow (the app's rule, couch-follow):
 * Home is the remote; a game opens its start page in the TV's room; a game that makes its own rooms
 * waits until the TV names one; a game this page doesn't know stays on the remote.
 */
export function guestScreen(
  target: FollowTarget,
  games: readonly { appId: string; startUrl: string; tvUrl?: string }[],
): GuestScreen {
  // Stryker disable next-line ConditionalExpression,StringLiteral: equivalent, a launcher target has no appId, so the lookup below finds nothing and says remote too
  if (target.kind === "launcher") return { kind: "remote" };
  const game = games.find((g) => g.appId === target.appId);
  if (!game) return { kind: "remote" };
  if (target.room)
    return { kind: "game", appId: game.appId, url: roomStartUrl(game.startUrl, target.room) };
  return game.tvUrl ? { kind: "game", appId: game.appId, url: game.startUrl } : { kind: "wait" };
}

const FollowTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("launcher") }),
  z.object({
    kind: z.literal("game"),
    appId: z.string(),
    instanceId: z.string(),
    roleId: z.string(),
    room: z.string().optional(),
  }),
]);
const GuestFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("follow"), target: FollowTargetSchema }),
  z.object({
    type: z.literal("state"),
    state: z.object({
      members: z.array(z.object({ name: z.string(), sticker: z.string() })),
      current: z.object({ appId: z.string() }).nullable().optional(),
    }),
  }),
]);

/** What a guest's browser takes from the couch session: follows, and who is on the couch. */
export type GuestFrame =
  | { type: "follow"; target: FollowTarget }
  | { type: "state"; members: { name: string; sticker: string }[]; currentAppId: string | null };

/** A couch session frame, parsed; null for anything a guest doesn't use. */
export function readGuestFrame(data: string): GuestFrame | null {
  // Not JSON: json stays undefined and fails the schema.
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {}
  const frame = GuestFrameSchema.safeParse(json);
  if (!frame.success) return null;
  if (frame.data.type === "follow") return frame.data;
  return {
    type: "state",
    members: frame.data.state.members.map(({ name, sticker }) => ({ name, sticker })),
    currentAppId: frame.data.state.current?.appId ?? null,
  };
}
