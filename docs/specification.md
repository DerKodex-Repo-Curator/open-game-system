# The OGS game contract

**Rendered** for game developers and their agents at https://ogs-docs.pages.dev/contract (Markdown: https://ogs-docs.pages.dev/contract.md), built from this file by `apps/docs`; edit it here.

**Status:** current (October 2026). This page is the single source of truth for what a web game does to
run in OGS. When code and this page disagree, the schemas in `packages/ogs-protocol/src/` win and this
page is fixed. Decision: [ADR 2026-10-04 OGS game contract](adrs/2026-10-04-ogs-game-contract.md).

It replaces the March 2026 "OGS Specification v1" (account linking, certification, per-game cast
sessions), which described a model OGS no longer uses. That text is in git history
(`git show c616c6b5:docs/specification.md`).

## The model in one paragraph

A grown-up casts **once** from the OGS app. The Chromecast (or any browser on the TV) shows one page for
the whole cast: the **TV launcher** (`apps/tv`). The launcher frames each game's **TV page** in an iframe and
swaps games without recasting. Phones and iPads play the game's **phone page** inside the app's
WebView. People join the couch with the **TV code** (a 6-character code per couch session), not a game's
room code. A game never casts, never shows a cast button, and still works in a plain browser.

Product spec: [OGS app v3](product-specs/ogs-app-v3.html). TV platforms (direct launcher vs WebRTC
stream): [ADR 2026-10-04 TV platforms](adrs/2026-10-04-tv-platforms.md).

## 1. Manifest and catalogue

A game is config, not code: one `Manifest` (`ManifestSchema` in
`packages/ogs-protocol/src/manifest.ts`). The catalogue is the list of manifests in
`services/api/src/catalogue.ts` (`CATALOGUE`), served at `GET /api/v1/catalogue`; the app's Library
reads it from there. `apps/mobile/services/game-directory.ts` is the old static list: don't add games to it.

| Field | Meaning |
|---|---|
| `appId` | `[a-z0-9-]+`; also the `aud` of every game token for this game |
| `name`, `tagline` | Shown in Library and on the TV |
| `shape` | `couch` · `live` · `async` |
| `tv` | `none` (phone only) · `optional` · `required` |
| `startUrl` | The phone page (also the controller when the TV shows the TV page) |
| `tvUrl` | Optional static TV page. Room-based games omit it and send the room's TV URL at runtime (§3) |
| `roles` | `{ id, label, audience: grownup \| kid \| little }[]` |
| `art` | See the art kit below |
| `shop` | `ages`, `minutes: [min, max]`, `players` |
| `instanceTtlMs` | How long a silent sitting lives (default 7 days) |
| `multiCouch` | `true`: several couches may join one room (§7). Default `false` |

`catalogueFor(env)` swaps in local `startUrl`s from `CATALOGUE_START_URLS` (JSON `{ appId: url }`) for
dev stacks and e2e runs; it never adds games.

### Art kit

Every catalogue game ships four images under `apps/tv/public/art/<appId>/`, referenced from `art`:

| Field | Image |
|---|---|
| `icon` | 1:1 icon |
| `cover` | 2:3 cover **with the title** |
| `logo` | Transparent logo |
| `heroClean` | 16:9 hero with **no text and no HUD** |

`tile` (required) and `hero` are older captured screenshots; `safe` (`scale`, `ox`, `oy`) crops their HUD
when no clean art exists. `services/api/test/catalogue.test.ts` fails if any catalogue game lacks the kit
or a file is missing. Contact sheet: `apps/tv/public/art/KIT-SHEET.jpg`. No faces on objects; each game
keeps its own look.

`art.theme` (a launcher music loop per game) is not on this branch yet; add it here when it merges.

## 2. The TV page, framed by the launcher

Messages are `LauncherToGameSchema` and `GameToLauncherSchema` in
`packages/ogs-protocol/src/frame.ts`, sent with `postMessage`. Every message is optional for the game:
a game that answers nothing still runs.

| Direction | Message | Payload | When |
|---|---|---|---|
| launcher → game | `ogs:start` | `instanceId`, `mode` (`continue` \| `new`), `roster`, `token`, `players?`, `room?` (§7) | On the frame's load, and again whenever the game says `ogs:ready` |
| game → launcher | `ogs:ready` | none | The page started listening (possibly after load); the launcher re-sends `ogs:start` for the current sitting |
| launcher → game | `ogs:suspend` | none | Home, or a swap to another game: the frame is **parked**, still loaded |
| launcher → game | `ogs:resume` | none | Continue of the parked sitting: the same frame comes back, no reload |
| game → launcher | `ogs:resume-point` | `label` | The sitting's label ("Mission 6") |
| game → launcher | `ogs:room` | `room` | The room the TV page shows. Every room-based game (no static `tvUrl`): the couch's other phones follow into this room (§3); `multiCouch` games also let other couches join it |
| game → launcher | `ogs:instance` | `report` (`InstanceReportSchema`) | Same purpose; the launcher uses `report.title` as the label |

- `token` is a **game token** for this game and this couch session (`aud` = appId, `sid`, `players`), or
  `""` when OGS could not sign one. The launcher's own token never reaches a game's origin.
- `players` is who's on the couch: `{ id, handle, name, avatar }[]` (`GamePlayerSchema`).
- The launcher accepts game messages only from the origin of the game's TV URL
  (`readFrameMessage` in `apps/tv/src/launcher/frames.ts`), and frames with `allow="autoplay; fullscreen"`.
  The TV page must allow being framed (no `X-Frame-Options: DENY` or a `frame-ancestors` that excludes
  the launcher).
- The launcher keeps one active frame and one parked frame (`nextFrames`); a third game unloads the
  oldest parked one.
- If a started game sends no TV page within 20 s (`VIEW_TIMEOUT_MS`), the TV says it didn't open.

With profile-kit (§4) a game doesn't post these by hand:

| Need | profile-kit |
|---|---|
| Who's on the couch, the session's game token | `useOgsSession()` (react) or `getOgsSessionSource()`: `undefined` while waiting, `null` when not framed by OGS (300 ms), else `{ players, token, instanceId, mode }`. Says `ogs:ready` itself |
| Go silent when parked | `onOgsPause((paused) => …)`: `true` on `ogs:suspend`, `false` on `ogs:resume`; never fires in a plain browser |
| The sitting's label | `reportOgsSitting({ instanceId, appId, status, title })`: `ogs:instance` to the launcher on the TV, the app bridge in the WebView, nothing in a plain browser |
| Rooms (§7) | `reportOgsRoom(room)` (TV page: `ogs:room`); `useOgsSession()` gives `room` when this couch joins another's; `ogsRoomFromUrl(location.href)` on the phone page (a second device of this couch, or another couch); `verifyOgsToken` returns `couch: { sid, label }` |

**Parked means silent.** A parked frame stays loaded so Continue is instant, so its audio keeps
playing unless the game stops it. Suspend the `AudioContext` and pause media on `onOgsPause(true)`; resume
on `false`, and only what was playing before. Pattern: `createAudioPause` in
`~/src/night-flight-owls/src/client/audio-pause.ts`.

## 3. Phones: the game page in the app's WebView

- The app opens `startUrl` in a WebView with the app bridge (`@open-game-system/app-bridge-*`).
- **Every couch phone follows the TV.** The phone that starts a game hosts it (its start page makes
  the room). Every other phone on the couch opens the same game when the TV starts it, and goes back
  to the remote on Home. For a room-based game (no static `tvUrl`) it waits until the TV page reports
  its room (`ogs:room`, §2) and opens `startUrl` with `ogsRoom=<room>` added to the query: the phone
  page must join that room (`ogsRoomFromUrl(location.href)`), never make a new one. A game that never
  reports its room gets no followers (their start page would make an empty room). Kids' iPads follow
  the same way (their roster seat when a roster was sent, else as a player). A following phone that
  swipes back steps out to the remote; the TV keeps playing.
- **Who's playing:** `useOgsProfile()` (`@open-game-system/profile-kit/react`) gives
  `{ id, handle, name, avatar, token }` from the app's `profile` bridge store (refreshed before the token
  expires). `undefined` while asking (up to 300 ms for the store, 5 s while the app says `asking`),
  `null` in a plain browser. With a profile, skip the game's name form and join under the OGS name and
  avatar; with `null`, keep the form.
- **The TV page of a room game:** the phone page declares it with cast-kit-react
  `useCastViewUrl(url)`. While cast through OGS the app forwards it to the couch session as `game.view`
  (`apps/mobile/services/game-cast-route.ts`) for the launcher to frame (only the host phone's page
  counts: a following phone's or iPad's `game.view` is ignored), and drops the game's
  `START_CASTING` / `STOP_CASTING` / `SHOW_CAST_PICKER`. A game with a static `tvUrl` needs nothing.
  `isOGSCastAvailable()` (cast-kit-core) tells the page it runs inside the OGS app.
- **Sitting labels:** `reportOgsSitting(...)` goes through the app's `ogs` bridge store as
  `INSTANCE_REPORT`, so two sittings of one game read apart in Playing. When nothing is reported, OGS
  names a sitting by when it started (`sittingName` in `packages/ogs-protocol/src/sitting.ts`).
  While cast, the report labels the couch session's live sitting of the game (the app files it under
  that sitting's id, as the launcher does with the TV page's `ogs:instance`), so the phone page and the
  TV page may both report: one start is one sitting. The game's own `instanceId` is used only when
  the phone plays alone.
- **Haptics:** the page dispatches `IMPACT { style: "light" | "medium" | "heavy" }` or
  `NOTIFY { kind: "success" | "warning" | "error" }` on the app's `haptics` bridge store
  (`HapticsBridgeEventSchema` in `packages/ogs-protocol/src/native.ts`); the app plays it with the
  platform's haptics. Unknown or malformed events are ignored.
- **Sign-in in a single-game app (OGS shell):** players start as guests (a device profile). The game
  has no sign-in UI: it dispatches `SIGN_IN` on the `account` bridge store
  (`AccountBridgeEventSchema`; state `{ login: "none" | "guest" | "apple" | "google", signingIn }`,
  `AccountBridgeStateSchema`) and the app shows its native sheet (profile-kit `requestOgsSignIn()`);
  the signed-in player then arrives through the `profile` store. There the ready profile also carries
  `login: "guest" | "apple" | "google"` (`ProfileLoginSchema`, optional on `OgsProfileSchema`; absent
  in the OGS app), so `useOgsProfile()` tells a guest from a signed-in player.
- **Own app or the OGS app (OGS shell):** a single-game app's WebView adds `OgsShell/<appId>` to the
  user agent (react-native-webview `applicationNameForUserAgent`; `shellUserAgentName` in
  `packages/shell/src/user-agent.ts`). The page checks `navigator.userAgent.includes("OgsShell/<appId>")`:
  true only in its own app, where the cast button is the game's (the one exception to "no cast button").
  The OGS app adds nothing, and `isOGSCastAvailable()` is true in both apps (it only sees the bridge).

## 4. Server: verify the token

- Game tokens are **ES256** JWTs signed by OGS, `aud` = the game's appId, valid 1 hour
  (`GameTokenSchema`, `GAME_TOKEN_TTL_S` in `packages/ogs-protocol/src/game-token.ts`). Claims: `iss`,
  `aud`, `sub` (profile id; the host's for a TV token), `handle`, `name`, `avatar`, `iat`, `exp`, plus
  `sid` and `players` on TV tokens, and `couch` (`{ sid, label }`) on every token issued for a couch (§7). Never friends, other games, device ids, push tokens or age.
- Public keys: `GET /.well-known/jwks.json` on the OGS API.
- Issued by `POST /api/v1/games/:appId/token` (the app, for a phone) and
  `POST /api/v1/sessions/:sid/game-token` (the launcher, for the TV).
- On the game's server: `verifyOgsToken(token, { appId })` from `@open-game-system/profile-kit/server`
  checks signature, `aud` and expiry and returns the claims or `null`. `jwksUrl` overrides the default
  (`OGS_JWKS_URL`, `https://api.opengame.org/.well-known/jwks.json`, a custom domain not yet confirmed
  on 2026-10-04); Rocket Crew sets it per environment as a Worker var (`OGS_JWKS_URL` in its
  `wrangler.toml`), which also lets seam tests use a local key set. Anything that matters (seats, scores) uses the verified
  claims; `readGameToken` in the page only decodes, for display.

## 5. Rules

1. **No cast button, no room code and no join UI on an OGS TV.** OGS casts; people join with the TV code
   or the launcher's QR (§8, planned). Outside OGS the game may keep its own room code, QR and TV link.
2. **Nothing covers the TV's focal area.** HUD and toasts stay at the edges.
3. **Still playable in a plain browser.** Every profile-kit call degrades to `null` / no-op there.
4. **Silent while parked** (§2).
5. **The game never sees the app's or the launcher's own token**, only game tokens for itself.

## 6. How to test it

Self-contained versions of these tests, for games outside this org: [Testing your game](../apps/docs/content/testing.md).

- **TV page:** frame it from a tiny parent page, post the launcher messages to the iframe and assert on
  the page. Examples (Playwright + vitest seam tests):
  - `~/src/night-flight-owls/e2e/ogs-pause.seam.test.ts` and `~/src/rocket-crew/e2e/ogs-pause.seam.test.ts`:
    `ogs:suspend` suspends every `AudioContext`, `ogs:resume` resumes it.
  - Do the same for `ogs:start` (players named on the TV) and for the `ogs:instance` the page posts back.
- **Phone page:** `~/src/rocket-crew/e2e/ogs-bridge.seam.test.ts` fakes the app's WebView bridge and signs
  game tokens with a local JWKS (`--var OGS_JWKS_URL:…`).
- **OGS side:** `packages/profile-kit/src/*.test.ts`, `apps/tv/src/launcher/frames.test.ts`,
  `services/api/test/catalogue.test.ts`; cross-surface suites in [testing/e2e.md](testing/e2e.md).

## 7. Several couches, one room (`multiCouch`)

Each living room keeps its own couch session, TV launcher and phones. Several couches can play one
**room** of a game: the game makes the room, the other couches join it, and the game groups players by
couch. Decision: [ADR 2026-10-05 couches join the game's room](adrs/2026-10-05-couches-join-the-games-room.md).
Acceptance: [multi-couch.feature](acceptance/2026-10-05-multi-couch.feature).

| Piece | Contract |
|---|---|
| Manifest | `multiCouch: true` (default `false`): the game accepts players from several couches in one room. OGS offers Invite and Join with your couch only for these games. |
| Room id | The game's own room code (`[A-Za-z0-9_-]{1,64}`, e.g. Night Flight's `KQTP`). OGS never makes one. |
| Game → launcher | `ogs:room` `{ room }`: the TV page says which room it shows (on create and whenever it changes). The launcher forwards it to the couch session as `game.room`; the sitting keeps it, the couch's other phones follow into it (§3), and friends' presence shows it. Every room-based game sends it, not only `multiCouch` ones. profile-kit: `reportOgsRoom(room)`. |
| Couch session | `game.start` takes `room?`. Starting a game with a room opens (or resumes) this couch's sitting **in that room**; without one the game makes its own as before. `current.room` and each paused sitting's `room` keep it, so Continue goes back into the same room. |
| Launcher → game | `ogs:start` carries `room` when the sitting names one: join that room, don't create one. |
| Phone page | When the sitting names a room, the app opens `startUrl` with `ogsRoom=<room>` added to its query (profile-kit: `ogsRoomFromUrl(location.href)`), so the host phone joins the room too. The same parameter brings this couch's other phones into the room (§3, "Every couch phone follows the TV"), for every room-based game, `multiCouch` or not. |
| Game token | Every token issued for a couch (the TV's, and a phone's when it asks with its session id) carries `couch: { sid, label }`: the couch session id and its label (the host's name). Players with the same `couch.sid` sit on the same couch. A token without `couch` is a phone with no couch (plain WebView): the game seats it with its TV's couch, or alone. |
| Leaving | Home on one TV parks only that couch's frame (`ogs:suspend`); the game marks that couch away and keeps the turn order going for the others. `ogs:resume` brings it back in the same room. |

**Invites.** `POST /api/v1/games/:appId/invites` `{ room, to: [profileId…] }` (a phone in a couch
session; only friends; only `multiCouch` games) sends each friend a push ("Jonathan invites you to Night
Flight") and answers the link `https://opengame.org/play/<appId>?room=<room>` (`PLAY_BASE_URL` overrides
the origin). The app opens that link (and `opengame://play/<appId>?room=<room>`): with a TV cast it sends
`game.start { appId, room }`, else it asks to cast first and then starts. opengame.org/play/… is a web page
that opens the app, or says how to get it.

**Join with your couch.** `GET /api/v1/friends/rooms` lists the rooms of `multiCouch` games your friends'
TVs are in: `{ appId, game, room, couches: [{ sessionId, label, host }], joined }`. Playing shows each as
"Jonathan and Sam are playing Night Flight" with **Join with your couch** (the same start as the link).
Presence (`casting`/`playing`) carries the `room` too. Join a friend's cast (sitting on *their* couch) is
unchanged.

## 8. Joining and invites (planned)

**Status: planned, not implemented.** Everything in this section is new and optional; a game that does
none of it keeps running. Product spec: [ogs-join.html](product-specs/ogs-join.html). Decision:
[ADR 2026-10-06 the launcher owns joining](adrs/2026-10-06-launcher-owns-joining.md). Acceptance:
[join-and-invite.feature](acceptance/2026-10-06-join-and-invite.feature).

| Item | Status | Contract |
|---|---|---|
| Games never draw join codes | planned (strengthens rule 1, §5) | On an OGS TV a game shows no room code, join QR, "join at" URL or cast button. The launcher draws the join QR next to the TV code on Home and Getting ready, and the invite card (below). Outside OGS the game may keep its own. |
| `ogs:invite` | planned | game → launcher, no payload. "Show people how to join now" (for example a "waiting for players" state). The launcher shows its invite card in the safe corner for 30 s; repeated messages restart the timer, they do not stack. Ignored from a frame that is not the current game. Equivalent to a couch phone tapping Invite someone. profile-kit: `requestOgsInvite()`, a no-op outside OGS. |
| `inviteCorner` (manifest) | planned | Optional: `top-right` (default), `top-left`, `bottom-right`, `bottom-left`. The corner where the launcher may draw the invite card, at most 220 x 120 CSS px on a 960 x 540 reference with a 24 px margin. The game keeps its focal area and HUD out of that rectangle. |
| `guest` token claim | planned | A guest (joined from the browser, no OGS profile) gets game tokens with `guest: true`, a per-session `sub`, `name` and `avatar`, and no `handle`. Games must not keep a guest's scores across sessions. `GameTokenSchema` gains `guest?: boolean` and `handle` becomes optional only when `guest` is true. |
| Guest phones | planned | A guest plays the game's `startUrl` in a plain browser (no app bridge): `useOgsProfile()` is `null` and the game keeps its name form unless it reads the guest identity the join page supplies as a game token. |
| Transfer link | planned | A game's own site (outside OGS only) may link "Play on TV with OGS" to `https://opengame.org/play/<appId>?room=<room>`, the same link as a friend invite (§7). It is hidden when `isOGSCastAvailable()` or `useOgsSession()` says the game is inside OGS. Without `room` it just starts the game. |

The join QR itself is launcher-level: it encodes `https://opengame.org/join/<code>` (the couch session's
TV code) and is never a game's job. Several households in one room are §7.

**Built (2026-10-06): every couch phone follows the TV** (§3). When the current game (its sitting) or
its room changes, the couch session sends every online phone and kid's iPad a `follow`: the host
`roleId: "host"`, every other one its roster role or `"player"`, with `room` once the TV named it; on
Home or end, the launcher. A phone or iPad that comes online mid-game is sent into it. Nothing else
re-sends it, so one that stepped out stays on the remote. Only the host's game page picks the TV page
(`game.view`). App phones and iPads only; browser guests follow when the web join page exists.

## 9. Notifications and links (planned)

**Status: built (2026-10-08), not deployed.** Optional: a game that does none of it keeps running. Product spec:
[push-notifications.md](product-specs/push-notifications.md). Decision:
[ADR 2026-10-07 game push and app links](adrs/2026-10-07-game-push-and-app-links.md). Acceptance:
[game-push.feature](acceptance/2026-10-07-game-push.feature), [game-links.feature](acceptance/2026-10-07-game-links.feature).

| Item | Status | Contract |
|---|---|---|
| Push handle | planned | An opaque id (`ph_…`) for one player in one game. The game's server stores it on the seat. It never names a device, profile or subscription; a handle for another game is refused. |
| Opt in, in the app | planned | profile-kit `requestOgsNotifications({ handle? })` from a tap: the app asks "Let <game> notify you?"; resolves `{ status: "granted", handle }`, `{ status: "denied" }`, or `null` outside the app. Never for a kid's profile. |
| Opt in, on the web | planned | notification-kit-web `subscribeOgsPush({ handle? })` from a tap in the game's PWA or tab: browser permission, subscribed with OGS's VAPID key for this game, `{ status: "granted", handle }`. `{ status: "unsupported", reason: "add-to-home-screen" }` in a Safari tab on iOS. The game serves OGS's `sw.js` at its origin root. |
| Send | planned | `POST /api/v1/games/:appId/notifications` with the game's API key: `{ to: [handle], title, body, url?, tag?, whenOpen? }`. `url` on the `startUrl` origin. Each handle answers `sent`, `not_permitted` or `gone` (drop it). OGS picks the handle's last-active surface (the OGS app or the PWA). Skip seats that are connected to your room. |
| While open | planned | profile-kit `onOgsNotification(handler)`: a push that arrives while the game is open and in front goes to the handler, not a banner (`whenOpen: "deliver"`, the default). No handler, or `whenOpen: "banner"`: the banner shows. |
| API key | planned | The game server's only OGS credential, one per game, kept as a secret (`OGS_API_KEY`). Issued by OGS on request. Token verification still needs none. |
| Links | planned | With the OGS app installed, a link to a game's URL opens that URL in the game's WebView: `opengame.org/play/<appId>` always; a game's own domain only when it is in the app's associated domains and serves the association files. Typed addresses never open the app: show "Open in OGS" (the transfer link, §8) outside OGS. |

Rule 5 holds: OGS never gives a game a device id, push token or subscription. Nothing a game sends may target a
kid, nag about streaks, or repeat what the TV is already showing.

## Acceptance

- [ogs-game-contract.feature](acceptance/2026-10-04-ogs-game-contract.feature): the TV page contract
  (start, ready, pause, labels, plain browser)
- [games-know-you.feature](acceptance/2026-10-04-games-know-you.feature): game tokens, profile, players
- [cast-first-app.feature](acceptance/2026-10-03-cast-first-app.feature): cast once, launcher, swaps,
  instances
- [ogs-profiles.feature](acceptance/2026-10-04-ogs-profiles.feature): profiles and joining with the TV code
- [multi-couch.feature](acceptance/2026-10-05-multi-couch.feature): several couches in one room (§7)
- [join-and-invite.feature](acceptance/2026-10-06-join-and-invite.feature): launcher join QR, web join, phones
  follow the TV, invite card, transfer link (§8, planned)
- [game-push.feature](acceptance/2026-10-07-game-push.feature) and
  [game-links.feature](acceptance/2026-10-07-game-links.feature): push handles, opt-in, sending, while open,
  links open the app (§9, planned)
