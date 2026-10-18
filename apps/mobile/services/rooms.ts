import {
  type ClientMessage,
  type FriendRoom,
  type Manifest,
  type PublicProfile,
  roomStartUrl,
  type SessionState,
  whoIsPlaying,
} from "@open-game-system/ogs-protocol";

/**
 * Several couches, one room (spec §7) in the app: joining a room (an invite link, Join with your
 * couch), what "Invite friends to this game" invites to, and the Playing cards for friends' rooms.
 */

type GameStart = Extract<ClientMessage, { type: "game.start" }>;

/** The start page of a joining couch (ogs-protocol, shared with the browser guest page). */
export { roomStartUrl };

export type RoomJoinPlan =
  | { kind: "tv"; start: GameStart; url: string }
  | { kind: "cast-first" }
  | { kind: "unknown-game" }
  | { kind: "single-couch" };

/** What joining a room does: start it on this couch's TV, or cast first. */
export function roomJoinPlan(input: {
  manifest: Manifest | undefined;
  ogsCast: boolean;
  deviceId: string;
  room: string;
}): RoomJoinPlan {
  const { manifest, room } = input;
  if (!manifest) return { kind: "unknown-game" };
  if (manifest.multiCouch !== true) return { kind: "single-couch" };
  if (!input.ogsCast) return { kind: "cast-first" };
  return {
    kind: "tv",
    start: {
      type: "game.start",
      appId: manifest.appId,
      mode: "new",
      hostDeviceId: input.deviceId,
      room,
    },
    url: roomStartUrl(manifest.startUrl, room),
  };
}

export type JoinOutcome = "started" | "cast-first" | "unknown-game" | "single-couch";

/**
 * Joins rooms for the app: at once while cast, else as soon as the TV is cast (the play screen
 * sends you to cast first). One join waits at a time; a newer one replaces it.
 */
export function createRoomJoiner(deps: {
  find: (appId: string) => Manifest | undefined;
  isCast: () => boolean;
  subscribeCast: (listener: () => void) => () => void;
  deviceId: () => string;
  send: (msg: GameStart) => void;
  open: (game: Manifest, url: string) => void;
}) {
  let waiting: { appId: string; room: string } | null = null;
  let off: (() => void) | null = null;
  const stopWaiting = () => {
    off?.();
    off = null;
    waiting = null;
  };

  function join(appId: string, room: string): JoinOutcome {
    const manifest = deps.find(appId);
    const plan = roomJoinPlan({
      manifest,
      ogsCast: deps.isCast(),
      deviceId: deps.deviceId(),
      room,
    });
    if (plan.kind === "unknown-game" || plan.kind === "single-couch") return plan.kind;
    stopWaiting();
    if (plan.kind === "tv" && manifest) {
      deps.send(plan.start);
      deps.open(manifest, plan.url);
      return "started";
    }
    waiting = { appId, room };
    off = deps.subscribeCast(() => {
      if (!waiting || !deps.isCast()) return;
      const next = waiting;
      stopWaiting();
      join(next.appId, next.room);
    });
    return "cast-first";
  }

  return { join, cancel: stopWaiting, pending: () => waiting };
}

/** The game "Invite friends to this game" invites to: the multiCouch game live on the TV, once it names its room. */
export function inviteTarget(
  state: SessionState | null,
  games: readonly Manifest[],
): { appId: string; name: string; room: string } | null {
  const current = state?.current;
  if (!current?.room) return null;
  const game = games.find((g) => g.appId === current.appId);
  if (game?.multiCouch !== true) return null;
  return { appId: game.appId, name: game.name, room: current.room };
}

export interface RoomCard {
  key: string;
  appId: string;
  room: string;
  /** "Jonathan and Sam are playing Night Flight". */
  title: string;
  hosts: PublicProfile[];
}

/** Friends' rooms this couch isn't in yet, as Playing cards. */
export function roomCards(rooms: readonly FriendRoom[]): RoomCard[] {
  return rooms
    .filter((r) => !r.joined)
    .map((r) => ({
      key: `${r.appId}:${r.room}`,
      appId: r.appId,
      room: r.room,
      title: `${whoIsPlaying(r.couches.map((c) => c.label))} ${r.game.name}`,
      hosts: r.couches.map((c) => c.host),
    }));
}

/** Friends' rooms (GET /friends/rooms) for Playing; a failed refresh keeps the last ones. */
export function createRoomsStore(api: { rooms: () => Promise<FriendRoom[]> }) {
  let rooms: FriendRoom[] = [];
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => rooms,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async refresh() {
      try {
        rooms = await api.rooms();
      } catch (err) {
        console.warn(`[ogs] friends' rooms failed: ${String(err)}`);
        return;
      }
      for (const l of listeners) l();
    },
  };
}

/** What the invite sheet says once it's sent: "Invited Sam and Kim." */
export function invitedLine(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `Invited ${names[0]}.`;
  return `Invited ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}.`;
}
