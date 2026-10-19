/**
 * try-kit: a no-app try path for a room-based web game (a TV page in a browser, phones as
 * controllers, joined by QR or a 4-letter code). This entry is pure: it runs in Workers, browsers
 * and tests. See `./worker` (Durable Object and Worker pieces), `./browser` and `./load`.
 */
export { IDLE_MS, joinGate, roomFree, type JoinGate, type RoomLife } from "./room-life";
export { ROOM_CODE, newRoomCode, parseRoomCode } from "./codes";
export { parseRef, wideEvent } from "./events";
export { NARROW_QUERY, isControllerDevice, offerThisComputer } from "./device";
export { probeWebSocket, type SocketLike } from "./probe";
