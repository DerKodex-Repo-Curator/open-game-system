import { DurableObject } from "cloudflare:workers";
import { claimRoomCode, deadEndPage, goPath, joinGate, RoomLifeStore, tvStartPath, wsProbe } from "../../src/worker";
import { parseRoomCode } from "../../src/index";

/** The id this fixture keeps on each socket (no casts: a guard). */
function socketId(ws: WebSocket): string | null {
  const a: unknown = ws.deserializeAttachment();
  return typeof a === "object" && a !== null && "id" in a && typeof a.id === "string" ? a.id : null;
}

type Env = { ROOM: DurableObjectNamespace<FixtureRoom>; IDLE_MS: string };

/** A room made with try-kit: a game's Durable Object owns a RoomLifeStore and calls it at each step. */
export class FixtureRoom extends DurableObject<Env> {
  private readonly life: RoomLifeStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.life = new RoomLifeStore(ctx, Number(env.IDLE_MS));
  }

  claim(): Promise<boolean> {
    return this.life.claim();
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const code = url.searchParams.get("code") ?? "";
    if (url.pathname === "/open") {
      await this.life.markOpened();
      return new Response("tv");
    }
    if (url.pathname === "/join") {
      const gate = joinGate({ ...(await this.life.life()), member: false, full: false }, Number(this.env.IDLE_MS));
      if (gate === "ok") return new Response("join");
      const status = { missing: 404, ended: 410, full: 409 }[gate];
      return new Response(deadEndPage({ game: "Fixture", gate, code }), { status, headers: { "content-type": "text/html" } });
    }
    if (url.pathname === "/online") return Response.json(this.life.online(socketId));
    if (url.pathname === "/ws") {
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ id: url.searchParams.get("id") ?? "anon" });
      await this.life.connected();
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("not found", { status: 404 });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    ws.close();
    await this.life.closed();
  }
}

const ROUTE = /^\/(tv|join|ws|online|claim)\/([A-Z]{4})$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const stub = (code: string) => env.ROOM.get(env.ROOM.idFromName(code));
    if (url.pathname === "/") {
      const code = await claimRoomCode((c) => stub(c).claim());
      return Response.redirect(new URL(tvStartPath(url, code), url).toString(), 302);
    }
    if (url.pathname === "/ws-probe") return wsProbe(req);
    if (url.pathname === "/go") return Response.redirect(new URL(goPath(url), url).toString(), 302);
    const m = ROUTE.exec(url.pathname);
    const code = m?.[2] ? parseRoomCode(m[2]) : null;
    if (!m || !code) return new Response("not found", { status: 404 });
    if (m[1] === "claim") {
      // A recycled room resets itself while claiming (throws): ask once more, like claimRoomCode.
      const ok = await stub(code).claim().catch(() => stub(code).claim());
      return Response.json({ ok });
    }
    const path = m[1] === "tv" ? "/open" : `/${m[1]}`;
    return stub(code).fetch(new Request(`https://room${path}?code=${code}&${url.searchParams}`, req));
  },
} satisfies ExportedHandler<Env>;
