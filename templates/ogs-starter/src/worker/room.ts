import { DurableObject } from "cloudflare:workers";
import { verifyOgsToken } from "@open-game-system/profile-kit/server";
import { z } from "zod";
import { ClientMessageSchema, type ServerMessage } from "../shared/protocol";
import { leave, seatFor } from "../shared/room-core";
import type { Seat } from "../shared/sim";
import type { Env } from "./index";

/** What each socket is, kept on the socket so it survives the Room hibernating. */
const TagSchema = z.union([
  z.object({ role: z.literal("screen") }),
  z.object({ role: z.literal("player"), seatId: z.string() }),
  z.object({ role: z.literal("new") }),
]);
type Tag = z.infer<typeof TagSchema>;

const tagOf = (ws: WebSocket): Tag => {
  const parsed = TagSchema.safeParse(ws.deserializeAttachment());
  return parsed.success ? parsed.data : { role: "new" };
};
const send = (ws: WebSocket, msg: ServerMessage) => ws.send(JSON.stringify(msg));

/**
 * One room: the TV page (the screen) and the phones (players). The Room seats players (an OGS
 * game token is verified here, on the server, before its name is trusted), forwards each stick to
 * the screen, and relays the screen's scoreboard to the phones. The TV page runs the game.
 */
export class Room extends DurableObject<Env> {
  private seats: Seat[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.seats = (await ctx.storage.get<Seat[]>("seats")) ?? [];
    });
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const created = (await this.ctx.storage.get<boolean>("created")) === true;
    if (path === "/create") {
      if (created) return new Response("taken", { status: 409 });
      await this.ctx.storage.put("created", true);
      return new Response("ok");
    }
    if (!created) {
      const error = { code: "no_room", message: "No such room", status: 404 };
      return Response.json({ error }, { status: 404 });
    }
    if (path === "/seats") return Response.json({ seats: this.seats });
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("Expected a WebSocket", { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: "new" } satisfies Tag);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let data: unknown;
    try {
      data = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    const parsed = ClientMessageSchema.safeParse(data);
    if (!parsed.success) return; // unknown or malformed: ignored, never trusted
    const msg = parsed.data;
    const tag = tagOf(ws);

    if (msg.type === "screen") {
      ws.serializeAttachment({ role: "screen" } satisfies Tag);
      send(ws, { type: "seats", seats: this.seats });
      return;
    }
    if (msg.type === "join") {
      const claims = msg.ogsToken
        ? await verifyOgsToken(msg.ogsToken, {
            appId: this.env.OGS_APP_ID,
            jwksUrl: this.env.OGS_JWKS_URL,
          })
        : null;
      const r = seatFor(this.seats, msg, claims);
      if (!r.ok) return send(ws, { type: "error", message: r.error });
      ws.serializeAttachment({ role: "player", seatId: r.seat.id } satisfies Tag);
      await this.setSeats(r.seats);
      send(ws, { type: "welcome", you: r.seat });
      return;
    }
    if (msg.type === "stick" && tag.role === "player") {
      for (const s of this.sockets("screen"))
        send(s, { type: "stick", id: tag.seatId, x: msg.x, y: msg.y });
      return;
    }
    if (msg.type === "scores" && tag.role === "screen") {
      for (const p of this.sockets("player")) send(p, msg);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const tag = tagOf(ws);
    if (tag.role !== "player") return;
    const stillHere = this.ctx
      .getWebSockets()
      .some(
        (other) => other !== ws && tagOf(other).role === "player" && sameSeat(other, tag.seatId),
      );
    if (!stillHere) await this.setSeats(leave(this.seats, tag.seatId));
  }

  private sockets(role: "screen" | "player"): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => tagOf(ws).role === role);
  }

  private async setSeats(seats: Seat[]): Promise<void> {
    this.seats = seats;
    await this.ctx.storage.put("seats", seats);
    for (const ws of this.ctx.getWebSockets()) {
      if (tagOf(ws).role !== "new") send(ws, { type: "seats", seats });
    }
  }
}

function sameSeat(ws: WebSocket, seatId: string): boolean {
  const tag = tagOf(ws);
  return tag.role === "player" && tag.seatId === seatId;
}
