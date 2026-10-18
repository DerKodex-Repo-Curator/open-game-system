import {
  type GuestJoined,
  type GuestScreen,
  guestScreen,
  readGuestFrame,
  stickerArt,
} from "@open-game-system/ogs-protocol";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

type Game = { appId: string; name: string; startUrl: string; tvUrl?: string };
type Press =
  | { type: "focus.move"; dir: "up" | "down" | "left" | "right" }
  | { type: "select"; deviceId: string }
  | { type: "back" }
  | { type: "home" };

const GamesSchema = z.array(
  z.object({
    appId: z.string(),
    name: z.string(),
    startUrl: z.string(),
    tvUrl: z.string().optional(),
  }),
);

/** The catalogue's games as this page needs them; nothing when the answer isn't a catalogue. */
function readGames(json: unknown): Game[] {
  const games = GamesSchema.safeParse(json);
  return games.success ? games.data : [];
}

/**
 * A guest on the couch from the browser: the remote while the TV is on Home, the game's phone page
 * when the TV starts one (every phone follows the TV), back to the remote on Home. The couch
 * session is the same WebSocket the app uses, with the guest's phone token.
 */
export function GuestCouch({
  api,
  launcher,
  joined,
}: {
  api: string;
  launcher: string;
  joined: GuestJoined;
}) {
  const [members, setMembers] = useState<{ name: string; sticker: string }[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [screen, setScreen] = useState<GuestScreen>({ kind: "remote" });
  const [online, setOnline] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const gamesRef = useRef<Game[]>([]);

  // The catalogue, once: which page each game's phones open.
  useEffect(() => {
    void fetch(`${api}/api/v1/catalogue`)
      .then((r) => r.json())
      .then((json: unknown) => {
        gamesRef.current = readGames(json);
        setGames(gamesRef.current);
      })
      .catch(() => {});
  }, [api]);

  // The couch session's WebSocket (an outside system), reconnecting after a drop.
  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const url = `${api.replace(/^http/, "ws")}/api/v1/couch/ws?token=${encodeURIComponent(joined.token)}&session=${encodeURIComponent(joined.sessionId)}`;
      const ws = new WebSocket(url);
      socket.current = ws;
      ws.onopen = () => setOnline(true);
      ws.onmessage = (ev) => {
        const frame = readGuestFrame(String(ev.data));
        if (frame?.type === "state") setMembers(frame.members);
        if (frame?.type === "follow") {
          const next = guestScreen(frame.target, gamesRef.current);
          if (next.kind !== "wait") setScreen(next);
        }
      };
      ws.onclose = () => {
        setOnline(false);
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket.current?.close();
    };
  }, [api, joined]);

  const press = (msg: Press) => socket.current?.send(JSON.stringify(msg));

  if (screen.kind === "game")
    return (
      <div className="fixed inset-0 bg-black" data-testid="guest-game" data-app={screen.appId}>
        <iframe
          title={games.find((g) => g.appId === screen.appId)?.name ?? screen.appId}
          src={screen.url}
          data-testid="guest-game-frame"
          className="w-full h-full border-0"
          allow="autoplay; fullscreen; microphone; clipboard-write"
        />
        <button
          type="button"
          data-testid="guest-to-remote"
          onClick={() => setScreen({ kind: "remote" })}
          className="absolute top-2 left-2 rounded-full bg-black/60 text-white text-sm px-3 py-1"
        >
          Remote
        </button>
      </div>
    );

  const key = "rounded-2xl bg-muted text-xl font-bold h-16 active:scale-95 transition-transform";
  return (
    <div data-testid="guest-remote">
      <p className="text-sm uppercase tracking-widest text-muted-foreground mb-2">
        {joined.tvName}
      </p>
      <h1 className="text-2xl font-bold mb-4">You're on the couch</h1>
      <ul className="flex justify-center flex-wrap gap-3 mb-6" data-testid="guest-couch">
        {members.map((m) => {
          const art = stickerArt(launcher, m.sticker);
          return (
            <li key={`${m.name}-${m.sticker}`} className="flex flex-col items-center w-14">
              {art ? <img src={art} alt="" className="w-12 h-12 object-contain" /> : null}
              <span className="text-xs truncate w-full">{m.name}</span>
            </li>
          );
        })}
      </ul>
      <div className="grid grid-cols-3 gap-3 max-w-[16rem] mx-auto" aria-label="Remote">
        <span />
        <button
          type="button"
          className={key}
          aria-label="Up"
          onClick={() => press({ type: "focus.move", dir: "up" })}
        >
          ↑
        </button>
        <span />
        <button
          type="button"
          className={key}
          aria-label="Left"
          onClick={() => press({ type: "focus.move", dir: "left" })}
        >
          ←
        </button>
        <button
          type="button"
          className={`${key} bg-primary text-primary-foreground`}
          data-testid="guest-ok"
          onClick={() => press({ type: "select", deviceId: "guest" })}
        >
          OK
        </button>
        <button
          type="button"
          className={key}
          aria-label="Right"
          onClick={() => press({ type: "focus.move", dir: "right" })}
        >
          →
        </button>
        <button
          type="button"
          className={`${key} text-base`}
          onClick={() => press({ type: "back" })}
        >
          Back
        </button>
        <button
          type="button"
          className={key}
          aria-label="Down"
          onClick={() => press({ type: "focus.move", dir: "down" })}
        >
          ↓
        </button>
        <button
          type="button"
          className={`${key} text-base`}
          onClick={() => press({ type: "home" })}
        >
          Home
        </button>
      </div>
      <p className="text-xs text-muted-foreground mt-6" data-testid="guest-status">
        {online
          ? "Connected to the TV. When a game starts, it opens here."
          : "Connecting to the TV…"}
      </p>
    </div>
  );
}
