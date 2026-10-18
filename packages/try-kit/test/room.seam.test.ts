/**
 * Seam tests at the Worker / Durable Object boundary: a minimal game made with try-kit (test/fixture)
 * under wrangler dev, over real HTTP and WebSockets. Its rooms are abandoned after 1.5 s.
 */
import { describe, expect, it } from "vitest";

const BASE = process.env.TRY_KIT_URL ?? "http://localhost:8956";
const WS = BASE.replace(/^http/, "ws");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The front page claims a code and opens its TV. */
async function newRoom(ref = ""): Promise<{ code: string; location: string }> {
  const res = await fetch(`${BASE}/${ref ? `?ref=${ref}` : ""}`, { redirect: "manual" });
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get("location") ?? "").pathname + new URL(res.headers.get("location") ?? "").search;
  const code = /\/tv\/([A-Z]{4})/.exec(location)?.[1] ?? "";
  return { code, location };
}

function connect(code: string, id: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/ws/${code}?id=${id}`);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", () => reject(new Error("socket failed")));
  });
}

async function online(code: string): Promise<string[]> {
  const body: unknown = await (await fetch(`${BASE}/online/${code}`)).json();
  return Array.isArray(body) ? body.filter((x): x is string => typeof x === "string") : [];
}

describe("try-kit at the Worker / Durable Object seam", () => {
  it("the front page claims a free code, keeps ?ref= and opens the room's TV", async () => {
    const a = await newRoom("HN");
    const b = await newRoom();
    expect(a.location).toBe(`/tv/${a.code}?ref=hn`);
    expect(b.code).not.toBe(a.code);
  });

  it("a phone can't join a code no TV has opened (a dead-end page that says so), and can once it has", async () => {
    const { code } = await newRoom();
    const before = await fetch(`${BASE}/join/${code}`);
    expect(before.status).toBe(404);
    expect(await before.text()).toContain("No game with that code");
    await fetch(`${BASE}/tv/${code}`);
    expect((await fetch(`${BASE}/join/${code}`)).status).toBe(200);
  });

  it("presence: the room knows who is connected", async () => {
    const { code } = await newRoom();
    await fetch(`${BASE}/tv/${code}`);
    const ada = await connect(code, "ada");
    const sam = await connect(code, "sam");
    expect((await online(code)).sort()).toEqual(["ada", "sam"]);
    sam.close();
    await wait(300);
    expect(await online(code)).toEqual(["ada"]);
    ada.close();
  });

  it("a live room is never handed out again", async () => {
    const { code } = await newRoom();
    await fetch(`${BASE}/tv/${code}`);
    const ada = await connect(code, "ada");
    expect(await (await fetch(`${BASE}/claim/${code}`)).json()).toEqual({ ok: false });
    ada.close();
  });

  it("an abandoned room says 'that game is over', and its code is recycled to a fresh, empty room", async () => {
    const { code } = await newRoom();
    await fetch(`${BASE}/tv/${code}`);
    (await connect(code, "ada")).close();
    await wait(2200);
    const ended = await fetch(`${BASE}/join/${code}`);
    expect(ended.status).toBe(410);
    expect(await ended.text()).toContain("That game is over");
    expect(await (await fetch(`${BASE}/claim/${code}`)).json()).toEqual({ ok: true });
    // Wiped: the new owner's TV hasn't opened it yet.
    expect((await fetch(`${BASE}/join/${code}`)).status).toBe(404);
  });

  it("/ws-probe echoes over a real WebSocket (the network check)", async () => {
    const ws = new WebSocket(`${WS}/ws-probe`);
    const echo = await new Promise<string>((resolve, reject) => {
      ws.addEventListener("open", () => ws.send("ping"));
      ws.addEventListener("message", (e) => resolve(String(e.data)));
      ws.addEventListener("error", () => reject(new Error("probe failed")));
    });
    expect(echo).toBe("echo:ping");
    ws.close();
  });

  it("/ws-probe?push also sends unprompted messages, like a game server pushing state", async () => {
    const ws = new WebSocket(`${WS}/ws-probe?push`);
    const first = await new Promise<string>((resolve, reject) => {
      ws.addEventListener("message", (e) => resolve(String(e.data)));
      ws.addEventListener("error", () => reject(new Error("socket failed")));
    });
    ws.close();
    expect(first).toBe("tick:1");
  }, 10_000);

  it("/go sends a retyped code to its join page", async () => {
    const res = await fetch(`${BASE}/go?code=ab-cd`, { redirect: "manual" });
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/join/ABCD");
  });
});
