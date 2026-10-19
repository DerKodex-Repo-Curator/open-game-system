/**
 * A room's life. Rooms are Durable Objects that keep their state and codes are only 4 letters, so
 * codes must be recycled: a room nobody has been connected to for IDLE_MS is over. The front page
 * may hand its code to a new TV (the old state is wiped), and a phone with an old code is told the
 * game has ended instead of sitting in an empty room. (Without this, a load test of 200 rooms put
 * new TVs inside old rooms once a few thousand existed.)
 */
export const IDLE_MS = 30 * 60_000;

export type RoomLife = {
  /** A TV page made this room (the game marks it; see RoomLifeStore.markOpened). */
  opened: boolean;
  /** Open WebSockets right now. */
  sockets: number;
  /** When the last socket closed (ms), null while someone is connected or nobody ever was. */
  idleSince: number | null;
  /** When the code was claimed (ms), null for a code nobody claimed. */
  createdAt: number | null;
  now: number;
};

function abandoned(r: RoomLife, idleMs: number): boolean {
  if (r.sockets > 0) return false;
  const lastSeen = r.idleSince ?? r.createdAt;
  // Opened before rooms kept timestamps: nobody is connected, so it's over.
  if (lastSeen === null) return r.opened;
  return r.now - lastSeen > idleMs;
}

export function roomFree(r: RoomLife, idleMs = IDLE_MS): boolean {
  if (!r.opened && r.createdAt === null) return true;
  return abandoned(r, idleMs);
}

export type JoinGate = "ok" | "missing" | "ended" | "full";

/** `member`: the caller already has a seat (a refresh). `full`: no seat left for a new phone. */
export function joinGate(r: RoomLife & { member: boolean; full: boolean }, idleMs = IDLE_MS): JoinGate {
  if (!r.opened) return "missing";
  if (r.member) return "ok";
  if (abandoned(r, idleMs)) return "ended";
  return r.full ? "full" : "ok";
}
