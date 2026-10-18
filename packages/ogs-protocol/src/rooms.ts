import { z } from "zod";
import { GameRefSchema, PublicProfileSchema } from "./friends";
import { RoomIdSchema } from "./session";

/** Several couches, one room (spec §7): invites, play links and friends' rooms. */

/** `<base>/play/<appId>?room=<room>`: the link an invite sends (opengame.org/play/… by default). */
export function playLink(base: string, appId: string, room: string): string {
  return `${base.replace(/\/+$/, "")}/play/${appId}?room=${encodeURIComponent(room)}`;
}

function queryParam(query: string, name: string): string {
  for (const pair of query.split("&")) {
    const [k, v = ""] = pair.split("=");
    if (k !== name) continue;
    try {
      return decodeURIComponent(v.replace(/\+/g, " "));
    } catch {
      return "";
    }
  }
  return "";
}

/** A play link (any origin, or the app's scheme: `opengame://play/<appId>?room=`) as its game and room. */
export function readPlayLink(url: string): { appId: string; room: string } | null {
  const m = /^(?:[a-z]+:\/\/[^/?#]+\/|[a-z]+:\/\/)play\/([a-z0-9-]+)\/?\?([^#]*)/.exec(url);
  if (!m?.[1]) return null;
  const room = RoomIdSchema.safeParse(queryParam(m[2] ?? "", "room"));
  return room.success ? { appId: m[1], room: room.data } : null;
}

/** POST /games/:appId/invites: the room and the friends (profile ids) to invite. */
export const GameInviteRequestSchema = z.object({
  room: RoomIdSchema,
  to: z.array(z.string().min(1)).min(1).max(20),
});
export type GameInviteRequest = z.infer<typeof GameInviteRequestSchema>;

/** What the invite did: the link, and for each friend whether a push went out. */
export const GameInviteResultSchema = z.object({
  link: z.string().url(),
  invited: z.array(z.object({ profileId: z.string(), pushed: z.boolean() })),
});
export type GameInviteResult = z.infer<typeof GameInviteResultSchema>;

/** One couch in a room: its session, its label (the host's name) and its host. */
export const RoomCouchSchema = z.object({
  sessionId: z.string(),
  label: z.string(),
  host: PublicProfileSchema,
});
export type RoomCouch = z.infer<typeof RoomCouchSchema>;

/** A room of a multiCouch game your friends' TVs are in (Join with your couch on Playing). */
export const FriendRoomSchema = z.object({
  appId: z.string(),
  game: GameRefSchema,
  room: RoomIdSchema,
  /** The couches in it, first to arrive first. */
  couches: z.array(RoomCouchSchema),
  /** Your own couch is in it already. */
  joined: z.boolean(),
});
export type FriendRoom = z.infer<typeof FriendRoomSchema>;

/** "Jonathan and Sam are playing" (the room card's line before the game's name). */
export function whoIsPlaying(labels: readonly string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return `${labels[0]} is playing`;
  const names = `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `${names} are playing`;
}

/** The start page of a joining couch: `ogsRoom=<room>` tells the game to join, not make, a room. */
export function roomStartUrl(startUrl: string, room: string): string {
  const [beforeHash, hash] = startUrl.split("#", 2);
  const sep = beforeHash.includes("?") ? "&" : "?";
  return `${beforeHash}${sep}ogsRoom=${encodeURIComponent(room)}${hash === undefined ? "" : `#${hash}`}`;
}
