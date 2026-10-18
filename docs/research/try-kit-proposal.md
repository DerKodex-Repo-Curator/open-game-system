# Proposal: try-kit, a no-app try path every game can add

**Status:** proposal, waiting on Jon. Branch `claude/browser-try-7b6dda` (not merged).
**Asks:** (1) keep `packages/try-kit` in the monorepo, (2) the dev starter adopts it,
(3) ogs-docs.pages.dev hosts its tarball next to profile-kit and cast-kit-core.

## Why

The Show HN post (docs/research/show-hn.md) needs a stranger to play from one link with no app:
a laptop opens the link and becomes the TV, phones scan a QR code and play in the browser. We built
that three times (Rocket Crew, Midnight Museum, Trivia Jam) and hit the same bugs each time:

| Bug | Found by | Where it bit |
|---|---|---|
| New TVs landed in old rooms once a few thousand existed (4-letter codes never recycled) | load test, 200 rooms | Rocket Crew |
| A phone with an old QR code sat in an empty room | load test | Rocket Crew, Trivia Jam |
| A network that blocks WebSockets showed a page that sat still | bug bash | all three |
| A phone opening the link got the TV page (phone browsers that report a mouse) | bug bash | Rocket Crew |
| A visitor alone at a laptop couldn't play at all | bug bash | all three |
| A wrong code dead-ended with no way to type it again | bug bash | Rocket Crew, Trivia Jam |
| `?ref=hn` lost on the redirect, so plays couldn't be counted by source | review | Rocket Crew |

The dev starter (`templates/ogs-starter` on `claude/dev-starter-58fe9a`) has the first two today:
its Room sets `created: true` and never clears it, so every code is used once, ever, and a room with
nobody in it stays open forever. Every game made from the starter would get these bugs.

## What it is

`packages/try-kit` (`@open-game-system/try-kit` 0.1.0): plain functions and one class, no framework,
four entry points (`.`, `./worker`, `./browser`, `./load`). Reference:
[apps/docs/content/try-kit.md](../../apps/docs/content/try-kit.md) (the ogs-docs page "try-kit:
no-app try path").

- **Room life** (`RoomLifeStore`, `claimRoomCode`, `joinGate`): codes from an alphabet without
  look-alikes; a room nobody has been connected to for 30 minutes is free, and claiming it wipes its
  storage; a phone gets in, or one of three dead ends (missing 404, ended 410, full 409).
- **Pages**: `deadEndPage` (type the code again, start a game), `mountNetworkBanner` + `wsProbe`,
  `qrDataUrl`, `offerThisComputer` + `openPlayerWindow`, `isControllerDevice`.
- **Measurement**: `parseRef`, `tvStartPath` (keeps `?ref=`), `wideEvent` (one log line per event;
  Workers Logs is the analytics), `runLoad` (N rooms, so many at a time, p50/p95/max).

**Tests:** 59 unit tests, plus 7 seam tests that run a fixture game (`test/fixture/worker.ts`, a
Durable Object built on the kit) under `wrangler dev` and check it from outside: codes, recycling
after the idle window with the old state gone, dead-end statuses, `/go`, presence, the probe.

## Proof: Rocket Crew runs on it

`~/src/rocket-crew-try` branch `try/show-hn`, commit 2749828, deployed to
https://rocket-crew-try.jonathanrmumm.workers.dev.

- The Room DO uses `RoomLifeStore` (with `opened` = actor-kit has spawned the room); the Worker uses
  `claimRoomCode`, `joinGate`, `tvStartPath`, `goPath` and `parseRef`; the pages use
  `mountNetworkBanner`, `isControllerDevice`, `qrDataUrl` and `offerThisComputer`.
- The game keeps what is its own: the dead-end copy and look (`messagePage`), `MAX_BENCH`, its
  WebSocket probe with a debug push mode, and its load test (it times each phase of a mission).
- Removed: 150 lines of game code and four test files whose behaviour is now tested in the kit
  (roomLife, startPath, deviceRole, connectionProbe). No other test was changed.
- Unit tests: 99 files, 1,062 tests pass. Typecheck clean.
- E2E against the redeployed preview: all green (below).

One visible change: the blocked-network banner is the kit's (same red, same place, one paragraph
instead of a bold first line).

## The starter, in about 20 lines

In `templates/ogs-starter`, add the tarball and change two files.

```jsonc
// package.json
"@open-game-system/try-kit": "file:vendor/try-kit.tgz",
```

```ts
// src/worker/room.ts
import { RoomLifeStore } from "@open-game-system/try-kit/worker";

export class Room extends DurableObject<Env> {
  private life: RoomLifeStore;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.life = new RoomLifeStore(ctx);
    // …seats as today
  }
  claim() { return this.life.claim(); }
  async fetch(request: Request) {
    const { opened } = await this.life.life();
    if (path === "/create") { await this.life.markOpened(); return new Response("ok"); }
    if (!opened) return Response.json({ error }, { status: 404 });
    // …after acceptWebSocket:
    await this.life.connected();
  }
  async webSocketClose() { await this.life.closed(); }
}
```

```ts
// src/worker/index.ts: POST /api/rooms
const code = await claimRoomCode((c) => env.ROOM.get(env.ROOM.idFromName(c)).claim());
await env.ROOM.get(env.ROOM.idFromName(code)).fetch("https://room/create", { method: "POST" });
return json({ code }, 201);
```

Plus `void mountNetworkBanner()` in `src/tv/main.ts` and `src/phone/main.ts`, `qrDataUrl` for the
TV's QR, and `/ws-probe` → `wsProbe(req)` in the Worker. The starter's JSON API keeps its error
shape; it would use `joinGate` on `GET /api/rooms/<code>` to answer 404/410/409 in its own
`{ error: { code, message, status } }` form rather than `deadEndPage`.

The starter's existing seam tests stay as they are. New seam tests, written first: a room nobody
has used for the idle window answers 410 and its code is handed out again with empty seats.

## Hosting

`scripts/update-kits.mjs` already fetches `profile-kit.tgz` and `cast-kit-core.tgz` from
`https://ogs-docs.pages.dev/pkg/`. Add `try-kit` to its `KITS` list and publish
`pkg/try-kit.tgz` the same way the others are published. Until then, games vendor a tarball built
from this branch (Rocket Crew does: `vendor/open-game-system-try-kit-0.1.0.tgz`).

## Not in the kit (on purpose)

- **Game copy and look.** `deadEndPage` has neutral copy and takes `copy` and `stylesheets`; a game
  may render its own page from the same `JoinGate`, as Rocket Crew does.
- **Seats and removal.** Who sits where, removing a stranger, a bench: each game's machine owns them.
- **actor-kit specifics.** The kit doesn't depend on actor-kit; the `opened()` hook is the seam.
- **Trivia Jam and Midnight Museum.** Not moved: Trivia Jam is TanStack Start with KV codes (a
  different room model), and Midnight Museum belongs to the museum-hillclimb session.

## Decisions for Jon

1. Keep `packages/try-kit` in the monorepo, and the docs page on ogs-docs (both previews on this
   branch).
2. Have the dev starter adopt it (the diff above), on the starter's branch, by its session.
3. Publish `pkg/try-kit.tgz` on ogs-docs.pages.dev next to the other kits.

## E2E status

Against https://rocket-crew-try.jonathanrmumm.workers.dev after the move (Oct 18):

| Suite | Result |
|---|---|
| e2e/room-life.seam.test.ts | pass |
| e2e/mission.seam.test.ts | pass |
| e2e/try-path.seam.test.ts | 4/4 |
| e2e/hn-rehearsal.seam.test.ts | 5/5 |

Running all four files at once on one laptop (several 3D TVs in parallel) failed three tests: two on
closing Chrome in `afterEach` and one press-to-TV time of 3.5 s against a 1.5 s budget. Run one file
at a time, every test passed. Run these suites one file at a time from a laptop.

Not checked on a real device after the move (iPhone, iPad, Chromecast): verified in Chrome and
emulated iPhones only.
