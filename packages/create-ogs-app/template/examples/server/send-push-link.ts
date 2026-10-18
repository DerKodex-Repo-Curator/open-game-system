import { createOgsNotifier } from "@open-game-system/notification-kit-server";

/** Links into the game: they open the app when it is installed, the web page when it isn't. */
export const LINK_BASE = "__OGS_LINK_BASE__";
/** Push links point at your game's own origin (the `startUrl` origin OGS knows). */
export const GAME_ORIGIN = "__OGS_GAME_ORIGIN__";

export interface Seat {
  name: string;
  /** The push handle from requestOgsNotifications(), if the player said yes. */
  handle: string | null;
  /** Connected to the room right now: don't push to them. */
  connected: boolean;
}

/** A link to share (a message, a QR code): opens this room in the app, or on the web. Use your game's own paths. */
export function roomLink(room: string): string {
  return `${LINK_BASE}/room/${encodeURIComponent(room)}`;
}

/**
 * "Your turn": one push to every seat that isn't connected. A tap opens the app on that room
 * (OGS sends it with your app's own APNs key / FCM account, uploaded with `ogs push credentials`).
 * Returns the handles OGS says are gone, to forget.
 */
export async function pingTurn(
  env: { OGS_API_KEY: string },
  room: string,
  from: string,
  seats: Seat[],
): Promise<string[]> {
  const to = seats.flatMap((s) => (!s.connected && s.handle ? [s.handle] : []));
  if (to.length === 0) return [];
  const notify = createOgsNotifier({ appId: "__OGS_APP_ID__", apiKey: env.OGS_API_KEY });
  const { results } = await notify({
    to,
    title: "Your turn",
    body: `${from} played. Your move.`,
    url: `${GAME_ORIGIN}/room/${encodeURIComponent(room)}`,
    tag: `turn-${room}`, // a later "your turn" for this room replaces this one
  });
  return results.flatMap((r) => (r.status === "gone" ? [r.to] : []));
}
