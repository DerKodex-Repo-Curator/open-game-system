/**
 * try-kit for Workers and Durable Objects: the room's life (claim, recycle, opened, presence), the
 * front page's code claim, a WebSocket echo for the network check, and the dead-end pages.
 */
import { newRoomCode, ROOM_CODE } from "./codes";
import { parseRef } from "./events";
import { IDLE_MS, type JoinGate, roomFree, type RoomLife } from "./room-life";

export { joinGate, roomFree, IDLE_MS, type RoomLife, type JoinGate } from "./room-life";

const OPENED = "try:opened";
const CREATED_AT = "try:createdAt";
const IDLE_SINCE = "try:idleSince";
const stamp = (v: unknown): number | null => (typeof v === "number" ? v : null);

/**
 * A room's life, kept in its Durable Object's storage. The game's DO owns one and calls it:
 * `claim()` from the front page (via `claimRoomCode`), `markOpened()` when a TV opens the room,
 * `connected()` / `closed()` from its socket handlers, `life()` before letting a phone join, and
 * `online()` for presence. Storage keys start with `try:`.
 */
export class RoomLifeStore {
  private readonly idleMs: number;
  private readonly isOpened: () => Promise<boolean>;

  /**
   * `idleMs`: how long an empty room lives (default IDLE_MS). `opened`: how this game knows a TV made
   * the room, when it already records that itself (an actor-kit room: its `actorId` is stored once
   * spawned); default: `markOpened()` was called.
   */
  constructor(
    private readonly ctx: DurableObjectState,
    opts: { idleMs?: number; opened?: () => Promise<boolean> } = {},
  ) {
    this.idleMs = opts.idleMs ?? IDLE_MS;
    this.isOpened = opts.opened ?? (async () => (await ctx.storage.get(OPENED)) === true);
  }

  #openSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  async life(): Promise<RoomLife> {
    const s = this.ctx.storage;
    const [opened, createdAt, idleSince] = await Promise.all([this.isOpened(), s.get(CREATED_AT), s.get(IDLE_SINCE)]);
    return { opened, sockets: this.#openSockets().length, idleSince: stamp(idleSince), createdAt: stamp(createdAt), now: Date.now() };
  }

  /**
   * The front page asks for this code for a new TV. True: it's ours (stamped now). False: in use.
   * An abandoned room is wiped and the object reset, which throws: ask again (claimRoomCode does)
   * and a fresh, empty object answers.
   */
  async claim(): Promise<boolean> {
    const life = await this.life();
    if (!roomFree(life, this.idleMs)) return false;
    if (life.opened || life.createdAt !== null) {
      await this.ctx.storage.deleteAll();
      this.ctx.abort("room code recycled");
    }
    await this.ctx.storage.put(CREATED_AT, life.now);
    return true;
  }

  /** A TV page opened the room: phones may join it now. */
  async markOpened(): Promise<void> {
    await this.ctx.storage.put(OPENED, true);
    if (stamp(await this.ctx.storage.get(CREATED_AT)) === null) await this.ctx.storage.put(CREATED_AT, Date.now());
  }

  /** A socket opened: the room is in use. */
  async connected(): Promise<void> {
    await this.ctx.storage.delete(IDLE_SINCE);
  }

  /** A socket closed (call after it closed): the last one out starts the idle clock. */
  async closed(): Promise<void> {
    if (this.#openSockets().length === 0) await this.ctx.storage.put(IDLE_SINCE, Date.now());
  }

  /** Who is connected now, by the game's own id for each socket (null: not a player). */
  online(idOf: (ws: WebSocket) => string | null): string[] {
    return this.#openSockets().flatMap((ws) => {
      const id = idOf(ws);
      return id === null ? [] : [id];
    });
  }
}

/**
 * Asks rooms for codes until one is free. A claim that throws (a recycled room reset itself) is asked
 * once more. A game with its own codes passes `newCode`.
 */
export async function claimRoomCode(
  claim: (code: string) => Promise<boolean>,
  rand: () => number = Math.random,
  newCode: (rand: () => number) => string = newRoomCode,
): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = newCode(rand);
    const ok = await claim(code).catch(() => claim(code).catch(() => false));
    if (ok) return code;
  }
  throw new Error("no free room code after 8 tries");
}

/** `/` → the new room's TV page, keeping a valid `?ref=` and nothing else. */
export function tvStartPath(url: URL, roomCode: string, tvPrefix = "/tv/"): string {
  const ref = parseRef(url.searchParams.get("ref"));
  return ref ? `${tvPrefix}${roomCode}?ref=${ref}` : `${tvPrefix}${roomCode}`;
}

/**
 * `/ws-probe`: a WebSocket echo, so pages can tell whether this network lets WebSockets through
 * (`probeWebSocket`, `mountNetworkBanner`). `?push` also sends `tick:1`, `tick:2`… every 2 s (30 at
 * most), like a game server pushing state, for checking a stream server or proxy.
 */
export function wsProbe(req: Request): Response {
  if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.addEventListener("message", (e) => server.send(`echo:${String(e.data)}`));
  if (new URL(req.url).searchParams.has("push")) {
    let n = 0;
    const timer = setInterval(() => {
      try {
        server.send(`tick:${++n}`);
      } catch {
        clearInterval(timer);
      }
      if (n >= 30) clearInterval(timer);
    }, 2000);
    server.addEventListener("close", () => clearInterval(timer));
  }
  return new Response(null, { status: 101, webSocket: client });
}

type Copy = { title: string; line: string };
const COPY: Record<Exclude<JoinGate, "ok">, Copy> = {
  missing: { title: "No game with that code", line: "Check the code on the big screen, or start your own game." },
  ended: { title: "That game is over", line: "Nobody has played in that room for a while. Start your own: it takes a laptop and a phone." },
  full: { title: "Every seat is taken", line: "Ask someone to give up theirs, or start your own game on another screen." },
};
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The page for a phone that can't join a room (`joinGate`): what happened, the code, a box to type
 * the code again (GET `/go?code=`, see `goPath`) and "Start a game". One primary action: Join for a
 * wrong code, Start a game when the room ended or is full. Bring your look with `stylesheets` (fonts
 * too): set `--try-accent`, `--try-on-accent`, `--try-bg`, `--try-ink` and `--try-font` on `:root`.
 */
export function deadEndPage(input: {
  game: string;
  gate: Exclude<JoinGate, "ok">;
  code: string;
  copy?: Partial<Record<Exclude<JoinGate, "ok">, Copy>>;
  stylesheets?: string[];
}): string {
  const { title, line } = { ...COPY[input.gate], ...input.copy?.[input.gate] };
  const code = ROOM_CODE.test(input.code) ? input.code : "";
  const game = escapeHtml(input.game);
  const wrong = input.gate === "missing";
  const links = (input.stylesheets ?? []).map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${game}</title>
<style>body{margin:0;background:var(--try-bg,#fff);color:var(--try-ink,#111)}.try-dead-end{max-width:30rem;margin:0 auto;padding:2rem 1.4rem;font:1rem/1.45 var(--try-font,system-ui,sans-serif);text-align:center}.try-dead-end form{display:flex;gap:.5rem;justify-content:center;margin:1rem 0}.try-dead-end input{width:7rem;font:700 1.4rem var(--try-font,system-ui,sans-serif);text-align:center;text-transform:uppercase;letter-spacing:.15em}.try-dead-end a,.try-dead-end button{display:inline-block;padding:.8rem 1.2rem;border-radius:.8rem;font:700 1rem var(--try-font,system-ui,sans-serif);text-decoration:none}.try-dead-end .primary{background:var(--try-accent,#4f46e5);color:var(--try-on-accent,#fff);border:0}.try-dead-end .secondary{background:none;color:inherit;border:2px solid currentColor}</style>${links}</head>
<body><main class="try-dead-end"><h1>${game}</h1>
<p><b>${escapeHtml(title)}</b>${code ? ` (${code})` : ""}</p><p>${escapeHtml(line)}</p>
<form action="/go" method="get"><input name="code" aria-label="Room code" placeholder="ABCD" maxlength="4" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" required><button class="${wrong ? "primary" : "secondary"}">Join</button></form>
<a class="${wrong ? "secondary" : "primary"}" href="/">Start a game</a></main></body></html>`;
}

/** `/go?code=abcd` (the dead-end page's form) → the room's join path, or the front page for a bad code. */
export function goPath(url: URL, joinPrefix = "/join/"): string {
  const code = (url.searchParams.get("code") ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  return ROOM_CODE.test(code) ? `${joinPrefix}${code}` : "/";
}
