import { newRoomCode } from "../shared/room-core";

export { Room } from "./room";

export interface Env {
  ASSETS: Fetcher;
  ROOM: DurableObjectNamespace;
  OGS_APP_ID: string;
  OGS_JWKS_URL: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const ROOM_PATH = /^\/api\/rooms\/([A-Z]{4})(\/ws)?$/;

/**
 * The game's one Worker. `POST /api/rooms` makes a room, `GET /api/rooms/<code>` says who sits in
 * it, `/api/rooms/<code>/ws` is its WebSocket. Everything else is the built pages (dist/).
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      for (let tries = 0; tries < 5; tries++) {
        const code = newRoomCode();
        const res = await env.ROOM.get(env.ROOM.idFromName(code)).fetch("https://room/create", {
          method: "POST",
        });
        if (res.ok) return json({ code }, 201);
      }
      return json({ error: { code: "no_room", message: "No free room code", status: 503 } }, 503);
    }
    const m = ROOM_PATH.exec(url.pathname);
    if (m?.[1]) {
      const room = env.ROOM.get(env.ROOM.idFromName(m[1]));
      return room.fetch(new Request(`https://room/${m[2] ? "ws" : "seats"}`, request));
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
