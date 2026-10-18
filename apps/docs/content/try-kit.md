# try-kit: a no-app try path

A stranger with a laptop and a phone should be able to play your game from one link, with no app
and no account: the laptop opens the link and becomes the TV, phones scan its QR code (or type its
4-letter code) and play in the browser. `@open-game-system/try-kit` is the part every room-based
game needs for that, taken from three games that shipped it (Rocket Crew, Midnight Museum, Trivia
Jam) and the bugs a load test and a bug bash found in them.

This is the plain-browser path. On an OGS TV there are no room codes or QR codes: see
[Rules and taste](rules.md). The kit's pages and banner never show inside the OGS launcher unless
your game puts them there.

> **Status: preview.** try-kit is not on npm yet. Build a tarball from the monorepo
> (`pnpm --filter @open-game-system/try-kit build`, then `pnpm pack` in `packages/try-kit`) and add
> it with `pnpm add file:vendor/open-game-system-try-kit-0.1.0.tgz`.

## What it gives you

| Need | Entry point | Export |
|---|---|---|
| 4-letter room codes without look-alikes (no I, L, O) | main | `ROOM_CODE`, `newRoomCode`, `parseRoomCode` |
| Codes that recycle: a room nobody used for 30 minutes is free again, and its old state is wiped | `/worker` | `RoomLifeStore`, `claimRoomCode` |
| What a phone with a code gets: in, "no game with that code", "that game is over" or "every seat is taken" | main, `/worker` | `joinGate`, `deadEndPage`, `goPath` |
| Who is connected right now (show a dropped player as away) | `/worker` | `RoomLifeStore.online` |
| A banner when the network blocks WebSockets (some office and school networks do) | `/worker`, `/browser` | `wsProbe`, `mountNetworkBanner` |
| The TV's QR code | `/browser` | `qrDataUrl` |
| "No phone handy? Play on this computer" | `/browser` | `offerThisComputer`, `openPlayerWindow` |
| A phone opening the link gets a phone page, not the TV | `/browser` | `isControllerDevice`, `NARROW_QUERY` |
| Where visitors came from (`?ref=hn`), one log line per event | main, `/worker` | `parseRef`, `tvStartPath`, `wideEvent` |
| A load test: N rooms, so many at a time, p50/p95/max | `/load` | `runLoad` |

## The Worker (about 20 lines)

Your room is a Durable Object. Give it a `RoomLifeStore` and call it at three moments: when a
socket opens, when one closes, and when the front page claims a code.

```ts
// room.ts
import { DurableObject } from "cloudflare:workers";
import { RoomLifeStore } from "@open-game-system/try-kit/worker";

export class Room extends DurableObject<Env> {
  life = new RoomLifeStore(this.ctx);

  claim() { return this.life.claim(); }
  lifeNow() { return this.life.life(); }

  async fetch(req: Request) {
    // …your WebSocket upgrade, then:
    await this.life.connected();
    return response;
  }
  async webSocketClose() { await this.life.closed(); }
}
```

Call `life.markOpened()` when a TV page makes the room. If your room already knows it was made
(an actor-kit room has spawned), pass that instead: `new RoomLifeStore(ctx, { opened: async () =>
(await ctx.storage.get("actorId")) !== undefined })`.

`claim()` returns `true` for a code nobody is using. For an abandoned room it wipes the room's
storage and resets the object (the call throws once); `claimRoomCode` asks again, and tries 8 codes
before it gives up.

```ts
// worker.ts
import { joinGate } from "@open-game-system/try-kit";
import { claimRoomCode, deadEndPage, goPath, tvStartPath, wsProbe } from "@open-game-system/try-kit/worker";

const room = (env: Env, code: string) => env.ROOM.get(env.ROOM.idFromName(code));

if (url.pathname === "/") {
  const code = await claimRoomCode((c) => room(env, c).claim());
  return Response.redirect(new URL(tvStartPath(url, code), url).toString(), 302); // keeps ?ref=
}
if (url.pathname === "/ws-probe") return wsProbe(req);
if (url.pathname === "/go") return Response.redirect(new URL(goPath(url), url).toString(), 302);
// On /join/:code, before serving the phone page:
const gate = joinGate({ ...(await room(env, code).lifeNow()), member, full });
if (gate !== "ok") {
  const status = { missing: 404, ended: 410, full: 409 }[gate];
  return new Response(deadEndPage({ game: "Your Game", gate, code, stylesheets: ["/styles.css"] }), {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
```

`member` is whether this caller already has a seat (a refresh always gets back in); `full` is
whether a new phone can still sit down. The dead-end page has a box to type the code again (it
submits to `/go`, because `/join` is often a static asset served before your Worker runs) and one
primary action. Pass `copy` to change its words, or render your own page from the same `gate`.

## The pages

```ts
import { mountNetworkBanner, offerThisComputer, openPlayerWindow, qrDataUrl } from "@open-game-system/try-kit/browser";

void mountNetworkBanner(); // every page, TV and phone

// The TV lobby:
qr.src = qrDataUrl(joinUrl);
const offer = offerThisComputer({ plainBrowserTv: !inOgs && !streamed, touchTv, needsPlayer });
if (offer) button.onclick = () => openPlayerWindow(`${joinUrl}?solo=1`);
```

On the front page, `isControllerDevice({ coarse: matchMedia("(pointer: coarse)").matches, narrow:
matchMedia(NARROW_QUERY).matches })` tells a phone (show it "open this on a laptop, or type a code")
from a laptop (make a room and show the TV).

## Measuring it

Every room event can be one `console.log` line, which Workers Logs keeps: `console.log(JSON.stringify(
wideEvent("game.round", { room, ref, players })))`. Rounds played by source is then a query, with no
analytics service. Never log names.

`runLoad({ rooms: 200, concurrency: 50, room: async (i) => { /* open a TV, join two phones */ } })`
returns how many rooms got through and p50/p95/max. Keep `concurrency` modest from one laptop: every
client runs there.

## Test it at the seam

Test the kit's behaviour in your game, not the kit: run your Worker under `wrangler dev` with a
short idle window (set `idleMs` from an env var, say 1.5 s) and assert from outside, as a visitor
would. The kit's own seam tests (`packages/try-kit/test/room.seam.test.ts`) are a template:

- `/` redirects to `/tv/ABCD`, and a second `/` gets a different code.
- An unknown code's join link answers 404 with the dead-end page; `/go?code=abcd` lands on
  `/join/ABCD`.
- After the idle window, an old join link answers 410, and claiming the code again gives a fresh
  room with none of the old state.
- Two sockets connected: `online` lists both; one closes: it lists one.

For the browser parts, see [Testing your game](testing.md): open the TV in a desktop context and the
phones in iPhone contexts, and block WebSockets with Playwright's `routeWebSocket` to see the banner.
