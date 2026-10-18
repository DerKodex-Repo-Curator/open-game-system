# Quickstart for agents

A checklist a coding agent (Claude Code, Codex, Cursor…) can follow end to end to make a web game
OGS-compatible, new or existing. Each step says what to change and how to know it is done. Work
test-first and commit after each green step.

## Prompt for your agent

One line, in the game's repository:

```text
Make this game OGS-compatible: follow https://ogs-docs.pages.dev/llms.txt
```

That is enough: llms.txt sends the agent here, to the kits and to the tests. Starting a new game
instead? Start from the [starter template](starter.md), which already does every step below.

## Before you start

Decide what OGS does for your game. This picks the steps:

| Your game today | OGS shape | What you build |
|---|---|---|
| Plays on one screen, no server (a Phaser or canvas game) | TV + phones (`tv: "required"`) | A **TV page** (your game, big) and a **phone page** (a controller). Phones talk to the TV through a small realtime server: copy the starter's room Worker (step 0) |
| Already has rooms: a TV/host screen and phones that join with a code | TV + phones | Steps 1–12 as written; your rooms are the room in steps 8–9 |
| Plays on each phone, no shared screen | Phone only (`tv: "none"`) | Steps 1, 5, 6, 7, 10–12 |

You need Node 20+ and a package manager (examples use pnpm; npm works the same). Pick an `appId`
now: lowercase letters, digits and hyphens (`[a-z0-9-]+`), for example `space-bakery`. It names your
game everywhere: the catalogue, the art folder and the `aud` of your game tokens.

Every profile-kit call returns `null` or does nothing in a plain browser, so after each step the game
must still play exactly as before outside OGS. Check that after every step.

## The checklist

### 0. No server yet? Add one for phone controllers

A one-screen game has nothing that carries a phone's input to the TV. First decide the shape:

- **Keep your page as it is** (it is the plain-browser version) and add two pages: a **TV page**
  (`/tv`, your game drawn big, its loop reading the phones' input) and a **phone page** (the
  controller; this is the manifest's `startUrl`). Share the game code between your page and `/tv`.
- **One player becomes one per phone.** A single-player game needs a ship (paddle, car…) per seated
  phone, plus what happens when phones join and leave. This is usually most of the work; keep it in a
  pure, tested module (the starter's `src/shared/sim.ts`).

Then the realtime room. Copy it from the [starter template](starter.md):

```bash
curl -fsSL https://ogs-docs.pages.dev/starter.tgz | tar xz   # → ./ogs-starter
```

| Copy | What it is |
|---|---|
| `src/worker/index.ts`, `src/worker/room.ts`, `src/worker/tsconfig.json` | The Worker and its Room Durable Object (one per room) |
| `src/shared/protocol.ts`, `src/shared/room-core.ts` | The messages (zod) and seating; `room-core` imports `Seat` from `src/shared/sim.ts`, so bring that type along |
| `src/client/socket.ts` | `createRoom()` and a reconnecting `connectRoom()` |
| `wrangler.jsonc`, `vite.config.ts` | The Worker serves the built pages from `dist/`; Vite builds `index.html` and `tv.html` |
| `.gitignore` entries | `dist`, `.wrangler`, `.dev.vars` |

And its dependencies:

```bash
pnpm add zod qrcode-generator
pnpm add -D wrangler @cloudflare/workers-types vitest playwright
```

wrangler needs the `esbuild` and `workerd` install scripts. pnpm 10 blocks them unless listed: add
`onlyBuiltDependencies: [esbuild, workerd]` to `pnpm-workspace.yaml` (pnpm 9: `"pnpm": {
"onlyBuiltDependencies": [...] }` in `package.json`), then `pnpm rebuild`.

The TV page joins its room as the screen; each phone joins as a player and sends its stick; the room
forwards sticks to the screen. Any realtime server works instead (PartyKit, Colyseus, your own
WebSocket server); OGS only needs a room code the TV page reports (step 9).

**Done when** in a plain browser `/tv` shows a room code, and a phone that joins it moves something on
the TV. For a canvas game, give the seam tests a read-only hook on the TV page (for example
`window.__game = () => world`) so they can see the move.

### 1. Install profile-kit

profile-kit is not on npm yet. The docs site hosts it, built from the OGS repo's `main`. Vendor the
tarball into your game (it bundles everything OGS-specific; it needs `zod`, and `react` only for
`/react`):

```bash
mkdir -p vendor
curl -fsSLo vendor/profile-kit.tgz https://ogs-docs.pages.dev/pkg/profile-kit.tgz
pnpm add ./vendor/profile-kit.tgz zod@^3.25   # npm: npm install ./vendor/profile-kit.tgz zod@^3.25
```

Room games also need cast-kit (step 8): `cast-kit-core` without React, or `cast-kit-react` with it.
Same pattern:

```bash
curl -fsSLo vendor/cast-kit-core.tgz https://ogs-docs.pages.dev/pkg/cast-kit-core.tgz
pnpm add ./vendor/cast-kit-core.tgz
```

Commit `vendor/`: the lockfile pins each tarball's hash. To update, download again and run
`pnpm install --force`.

**Done when** `import { onOgsPause } from "@open-game-system/profile-kit"` type-checks.

### 2. Make the TV page frameable

The launcher loads your TV page in an iframe with `allow="autoplay; fullscreen"`.

- Do not send `X-Frame-Options: DENY`/`SAMEORIGIN`, and no `Content-Security-Policy: frame-ancestors`
  that excludes the launcher.
- Start without a tap: there is no pointer on a TV. Start audio and animation on load. (In a plain
  browser the `AudioContext` still starts suspended; resume it on the first `pointerdown` or
  `keydown`.)
- Hide any full-screen button when framed (`window.parent !== window`); the launcher already fills the TV.

**Done when** a plain HTML page with `<iframe src="YOUR_TV_URL">` shows your TV page playing.

### 3. TV page: hear the launcher

Create the session source at module load of the TV entry (the launcher posts `ogs:start` as soon as
the frame loads; profile-kit says `ogs:ready` so a missed start is re-sent).

```ts
// tv entry (module scope)
import { getOgsSessionSource, onOgsPause } from "@open-game-system/profile-kit";

getOgsSessionSource(); // start listening now
onOgsPause((paused) => audio.setPaused(paused)); // ogs:suspend → true, ogs:resume → false
```

Without React, read the same store:

```ts
const session = getOgsSessionSource();
const render = () => {
  const s = session.getSnapshot(); // undefined: waiting · null: plain browser · else on the OGS TV
  joinPanel.hidden = s !== null; // no code or QR on the OGS TV, and none while still waiting
  if (s) showCouch(s.players.map((p) => p.name));
};
session.subscribe(render);
render();
```

In React, read the couch with the hook:

```tsx
import { useOgsSession } from "@open-game-system/profile-kit/react";

function TvPlayers() {
  const session = useOgsSession();
  if (session === undefined) return null; // waiting for the launcher (≤ 300 ms)
  if (session === null) return <JoinCodeAndQr />; // not on an OGS TV: keep your own join UI
  return <Seats players={session.players} />; // { id, handle, name, avatar }[]
}
```

- `ogs:start` → `session` with `players`, `token` (a game token, or `""`), `instanceId`, `mode`
  (`"continue"` or `"new"`), and `room` for multi-couch games.
- `ogs:suspend` → `onOgsPause(true)`: **go silent**. Suspend your `AudioContext`, pause every
  `<audio>`/`<video>`, stop timers that make sound. Keep the game state; the frame stays loaded.
- `ogs:resume` → `onOgsPause(false)`: resume only what was playing before.
- A real-time game also **stops its simulation** while parked (skip the update step, keep drawing or
  not), or rocks keep falling in a frame nobody is watching.

A safe audio gate (suspends the shared context on pause, resumes it on Continue only if it was
running, and keeps a sound unlocked during the pause silent):

```ts
export function createAudioPause(getCtx: () => AudioContext | null) {
  let paused = false;
  let parked: AudioContext | null = null;
  return {
    setPaused(next: boolean) {
      if (next === paused) return;
      paused = next;
      if (paused) {
        const ctx = getCtx();
        if (ctx?.state === "running") { parked = ctx; void ctx.suspend(); }
        return;
      }
      const ctx = parked;
      parked = null;
      if (ctx?.state === "suspended") void ctx.resume();
    },
    paused: () => paused,
  };
}
```

**Done when** the seam test in [Testing](testing.md#1-the-tv-page-in-a-stand-in-launcher) passes:
every `AudioContext` is `suspended` after `ogs:suspend` and `running` after `ogs:resume`, and the TV
names the players from `ogs:start`.

### 4. TV page: no join UI inside OGS

When `useOgsSession()` (or `getOgsSessionSource().getSnapshot()`) is a session, hide your room code,
join QR, "join at" URL and cast button. OGS draws its own TV code. When it is `null` (a plain browser),
keep them: the game must still be joinable on its own.

**Done when** the framed TV page shows no code or QR after `ogs:start`, and the unframed page still does.

### 5. Phone page: use the OGS profile

```tsx
import { useOgsProfile } from "@open-game-system/profile-kit/react";

function Join() {
  const profile = useOgsProfile();
  if (profile === undefined) return <p>Joining…</p>; // asking the app (≤ 300 ms, ≤ 5 s while it fetches)
  if (profile === null) return <NameForm />; // plain browser: your own form, unchanged
  // In the OGS app: join at once under the OGS name and avatar, and send the token to your server.
  return <AutoJoin name={profile.name} avatar={profile.avatar} token={profile.token} />;
}
```

Without React, wait for the app's answer once, then decide:

```ts
import { getOgsProfileSource, type OgsProfile } from "@open-game-system/profile-kit";

function profileOnce(): Promise<OgsProfile | null> {
  const source = getOgsProfileSource();
  return new Promise((resolve) => {
    const done = () => {
      const p = source.getSnapshot();
      if (p === undefined) return false; // still asking the app
      resolve(p);
      return true;
    };
    if (done()) return;
    const off = source.subscribe(() => {
      if (done()) off();
    });
  });
}

const profile = await profileOnce();
if (profile) joinRoom({ ogsToken: profile.token }); // no form
else showNameForm(); // plain browser: unchanged
```

- Join **once** per seat. The app refreshes the token before it expires; a new token must not join again.
- Hide your join code entry: OGS puts the phone in the right game already.
- No React? `getOgsProfileSource()` is the same store: `getSnapshot()` and `subscribe(listener)`.

**Done when** in a fake WebView (see [Testing](testing.md#2-the-phone-page-in-a-fake-webview)) the
page joins without a form under the OGS name, and in a plain browser the form is unchanged.

### 6. Server: verify game tokens

Anything that matters (a seat, a score, a name other players see) must come from a verified token.

```ts
import { verifyOgsToken } from "@open-game-system/profile-kit/server";

const claims = await verifyOgsToken(token, { appId: "space-bakery", jwksUrl: env.OGS_JWKS_URL });
if (!claims) return joinAsGuest(); // bad signature, other game, expired, or no token: the plain-browser path
seat({ id: claims.sub, name: claims.name, avatar: claims.avatar, couch: claims.couch?.sid });
```

- It checks the ES256 signature against OGS's JWKS, `aud === appId`, and expiry; anything else is `null`.
- Make `jwksUrl` configuration (a Worker var such as `OGS_JWKS_URL`), so seam tests can serve a local
  key set. In production it is
  `https://opengame-api.jonathanrmumm.workers.dev/.well-known/jwks.json`. Always pass it: profile-kit's
  built-in default (`api.opengame.org`) does not resolve yet.
- Send the token over your own connection (the join message, a header); a game server that has no
  token, or a token that fails, falls back to the guest path.
- In the page, `readGameToken(token)` only decodes (for display). Never trust it for anything else.

**Done when** a test signs a token with a local key and your server seats that player, and rejects a
token for another `appId` and an expired one.

### 7. Report the sitting's label

```ts
import { reportOgsSitting } from "@open-game-system/profile-kit";

reportOgsSitting({ instanceId, appId: "space-bakery", status: "active", title: "Mission 6" });
```

Call it whenever the label changes (not every frame), from the TV page, the phone page, or both: in
the app's WebView it goes over the app bridge, on the TV to the launcher, in a plain browser nowhere.
On the TV use the `instanceId` from `ogs:start`. `status` is one of `lobby`, `active`, `suspended`,
`waiting`, `completed`, `expired`. `title` is the label people see; pick what tells two sittings
apart: the round or level ("Round 3"), or for a game with neither, the room ("Room KQTP"). `detail`
is optional extra text.

**Done when** the TV seam test receives an `ogs:instance` message with your title.

### 8. Room games: declare the TV page from the phone

Skip this if your manifest has a static `tvUrl`. If each room has its own TV URL, the host's phone
page declares it while inside OGS. Inside OGS the phone that starts the game makes the room (the TV
page opens later, at the URL you declare, with the room in it); in a plain browser your TV page may
keep making its own room as before. Declare it (cast-kit, packed from the OGS repo like profile-kit):

```tsx
import { isOGSCastAvailable } from "@open-game-system/cast-kit-core";
import { CastProvider, useCastViewUrl } from "@open-game-system/cast-kit-react";

function DeclareTv({ tvUrl }: { tvUrl: string }) {
  useCastViewUrl(tvUrl); // the app forwards it to the launcher, which frames it
  return null;
}

export function HostPanel({ tvUrl }: { tvUrl: string }) {
  const inOgs = useMemo(() => isOGSCastAvailable(), []);
  return inOgs ? <CastProvider><DeclareTv tvUrl={tvUrl} /></CastProvider> : <OwnTvLinkAndQr />;
}
```

Without React, dispatch `SET_VIEW_URL` on cast-kit-core's `cast` store. The app sends that store a
moment after the page loads, and a dispatch before it exists is dropped, so wait for it:

```ts
import { getCastBridge, isOGSCastAvailable } from "@open-game-system/cast-kit-core";

function declareTvPage(url: string) {
  const bridge = getCastBridge();
  if (!bridge || !isOGSCastAvailable()) return; // a plain browser: show your own TV link instead
  const send = () => {
    const store = bridge.getStore("cast");
    store?.dispatch({ type: "SET_VIEW_URL", url });
    return Boolean(store);
  };
  if (send()) return;
  const off = bridge.subscribe(() => {
    if (send()) off();
  });
}

// the phone that starts the game, once its room exists:
declareTvPage(`${location.origin}/tv?room=${code}`);
```

No `<CastButton>` and no cast calls: the app ignores a game's own cast actions. Reference:
[cast-kit](cast-kit.md).

### 9. Rooms: the couch's phones, and other homes

A game with rooms: call `reportOgsRoom(roomCode)` from the TV page when the room exists, and on the
phone page join `ogsRoomFromUrl(location.href)` instead of making a room when it is not `null`. Every
phone on the couch follows the TV: the one that starts the game makes the room, the others open your
start page with `ogsRoom=<room>` once the TV page reported it (no report, no followers).

Several homes in one room (optional): only if households in different homes should play one room
together. Set `multiCouch: true` in the manifest, join `session.room` instead of creating a room when
`ogs:start` carries one, and group players by `claims.couch.sid`. Details:
[the contract, §7](contract.md#7-several-couches-one-room-multicouch).

### 10. Art kit and manifest

Make the four images and write the manifest: see [Art kit and catalogue](art-and-catalogue.md). The
manifest's fields are in [Messages and manifest](messages.md#manifest). Three things the schema
doesn't tell you:

- **`roles`** is optional in the schema, but the catalogue wants at least one role a kid can play
  (`audience: "kid"` or `"little"`) unless your game is for grown-ups only (say so in the pull request).
- **`startUrl`** must be a full URL. Until your game is deployed, use a placeholder and replace it
  before the pull request.
- **Check it with the real schema:** vendor
  [ogs-protocol](https://ogs-docs.pages.dev/pkg/ogs-protocol.tgz) like the kits (step 1, as a dev
  dependency) and test `ManifestSchema.parse(manifest)`.

Keep the images in your repo (for example `art/`) until the pull request copies them to
`apps/tv/public/art/<appId>/`.

### 11. Test it

Write the seam tests from [Testing your game](testing.md): the TV page in a stand-in launcher, the
phone page in a fake WebView, no full-screen button when framed, and the plain-browser check. Then run
the whole game end to end in a plain browser once more.

### 12. Submit to the catalogue

Open a pull request to the OGS repository with your manifest and art kit:
[Art kit and catalogue](art-and-catalogue.md#submit-to-the-catalogue).

### 13. Tell players when it's their turn (optional)

Only for a game where a player waits on someone who isn't looking: a turn over days, a round waiting
on them, another couch joining. Skip it for a game everyone plays live in front of the TV.

1. Right after the player's first move, from that tap, ask once: in the OGS app
   `requestOgsNotifications()` (profile-kit); on your own site `subscribeOgsPush({ appId })`
   (notification-kit-web, plus OGS's `sw.js` at your origin root). Send the handle to your server.
2. Ask OGS for your game's API key and keep it as a secret (`OGS_API_KEY`).
3. On your server, at each handoff, `createOgsNotifier({ appId, apiKey })` and send to the seats that
   aren't connected. Drop a handle that answers `gone`.

**Done when** a seam test shows a disconnected seat gets one push per handoff and a connected one gets
none. Details: [Notifications](notifications.md).

## Done when

- The seam tests pass, and the game plays end to end in a plain browser.
- In the OGS app: no name form on phones, the TV shows the couch's names, Home silences the TV,
  Continue brings it back with sound, and Playing shows your sitting label.
- Nothing on the OGS TV shows a cast button, a room code or a join QR.
