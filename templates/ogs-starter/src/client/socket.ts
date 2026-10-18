import {
  type ClientMessage,
  CreatedRoomSchema,
  type ServerMessage,
  ServerMessageSchema,
} from "../shared/protocol";

/** Make a room on the game's Worker. */
export async function createRoom(): Promise<string> {
  const res = await fetch("/api/rooms", { method: "POST" });
  return CreatedRoomSchema.parse(await res.json()).code;
}

/**
 * The room's WebSocket, reconnecting after a drop. `hello` is sent on every (re)connect, so the
 * room always knows who this socket is.
 */
export function connectRoom(
  code: string,
  hello: ClientMessage,
  onMessage: (msg: ServerMessage) => void,
): { send(msg: ClientMessage): void } {
  let ws: WebSocket | null = null;
  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws`);
    ws.addEventListener("open", () => ws?.send(JSON.stringify(hello)));
    ws.addEventListener("message", (e) => {
      try {
        const parsed = ServerMessageSchema.safeParse(JSON.parse(String(e.data)));
        if (parsed.success) onMessage(parsed.data);
      } catch {
        // not JSON: ignore
      }
    });
    ws.addEventListener("close", () => setTimeout(open, 1000));
  };
  open();
  return {
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
  };
}
