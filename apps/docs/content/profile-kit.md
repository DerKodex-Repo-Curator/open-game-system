# profile-kit reference

`@open-game-system/profile-kit` is how a game learns who is playing and talks to OGS. It has three
entry points: the main one (browser, no framework), `/react` (hooks) and `/server` (token
verification). Every browser call degrades to `null` or a no-op in a plain browser and on the server,
so the same code runs everywhere. Install: [Quickstart, step 1](quickstart.md#1-install-profile-kit).

This page lists **every** export, and a test fails the docs build when the package gains or loses
one. Source: [packages/profile-kit/src](../../../packages/profile-kit/src/index.ts).

## `@open-game-system/profile-kit`

### Use these

#### `getOgsProfileSource`

```ts
function getOgsProfileSource(): Source<ProfileSnapshot>
```

The page's OGS profile as an external store (one per page). In the OGS app's WebView it follows the
app's `profile` bridge store, including refreshed tokens. `getSnapshot()` is `undefined` while asking
the app, `null` with no profile (plain browser, server), or an `OgsProfile`. The React hook
`useOgsProfile()` reads it.

#### `getOgsSessionSource`

```ts
function getOgsSessionSource(): Source<SessionSnapshot>
```

The couch session from the TV launcher (one per page). Created on first call: it starts listening
for `ogs:start` and posts `ogs:ready` to the launcher. Call it at module load of the TV entry.
`getSnapshot()` is `undefined` while waiting, `null` when the page is not framed by the launcher
(after 300 ms, or at once when not framed), or an `OgsSession`.

#### `onOgsPause`

```ts
function onOgsPause(onPause: (paused: boolean) => void): () => void
```

Calls `onPause(true)` on `ogs:suspend` (the launcher parked the frame: Home, or another game) and
`onPause(false)` on `ogs:resume` (Continue). Returns a function that stops listening. Never fires in
a plain browser. Only messages from the parent window count.

#### `reportOgsSitting`

```ts
function reportOgsSitting(report: InstanceReportInput): "bridge" | "launcher" | "none"
```

Tells OGS about this sitting; its `title` is the label people see ("Mission 6"). In the OGS app's
WebView it dispatches `INSTANCE_REPORT` to the app's `ogs` bridge store (`"bridge"`); framed by the
launcher it posts `ogs:instance` (`"launcher"`); elsewhere nothing (`"none"`). Throws if the report
fails `InstanceReportSchema`.

#### `reportOgsRoom`

```ts
function reportOgsRoom(room: string): "launcher" | "none"
```

Room-based games: the TV page says which room it shows (`ogs:room`), so the couch's other phones
follow into that room (and, for `multiCouch` games, other couches can join it). Throws if `room` is not
a valid room id (`[A-Za-z0-9_-]{1,64}`). `"none"` when not framed.

#### `ogsRoomFromUrl`

```ts
function ogsRoomFromUrl(url: string): string | null
```

Phone page of a room-based game: the room in the `ogsRoom` query parameter the app adds when this
phone joins a room it didn't make (a second phone of the couch following the TV, or a couch joining
another couch's room). Join it instead of making one. `null` when there is none or it is not a valid
room id. Use `ogsRoomFromUrl(location.href)`.

#### `readGameToken`

```ts
function readGameToken(token: string): GameToken | null
```

Decodes a game token's claims **without verifying** it, for display only. Anything that matters
must use `verifyOgsToken` on your server.

#### `requestOgsNotifications`

```ts
function requestOgsNotifications(join?: { handle?: string }): Promise<PushConsentResult | null>
```

Asks the player, inside the OGS app, whether this game may notify them. Call it from a tap, at the
first moment a push would help ("Ping me when it's my turn again?"). The app shows its own sheet and
resolves `{ status: "granted", handle }` or `{ status: "denied" }`; `null` outside the OGS app (in
your PWA use notification-kit-web's `subscribeOgsPush`). Send the handle to your server and store it
on the seat; pass a handle you already hold (`{ handle }`) to add the app to it. A kid's iPad is always
denied. See [Notifications](notifications.md).

#### `onOgsNotification`

```ts
function onOgsNotification(handler: (notification: OgsNotification) => void): () => void
```

Hears a push that arrived while this game is open and in front, in the OGS app or in your PWA (from
its `sw.js`). OGS shows no system banner for it, so show your own hint or just update the page.
Returns a function that stops listening. With no handler, the banner shows as usual.

### Types

#### `OgsProfile`

```ts
type OgsProfile = { id: string; handle: string; name: string; avatar: string; token: string }
```

The player on this device: profile id, @handle, name, avatar URL and a game token for this game.

#### `ProfileSnapshot`

```ts
type ProfileSnapshot = OgsProfile | null | undefined
```

`undefined` = still asking the app · `null` = no OGS profile (plain browser) · the profile.

#### `OgsSession`

```ts
interface OgsSession {
  players: GamePlayer[];
  token: string;
  instanceId: string;
  mode: "continue" | "new";
  room?: string;
}
```

What the TV page knows from `ogs:start`: who is on the couch, a game token for the session (`""`
when OGS could not sign one), the sitting and whether it continues, and the room to join
(`multiCouch` games).

#### `SessionSnapshot`

```ts
type SessionSnapshot = OgsSession | null | undefined
```

`undefined` = waiting for the launcher · `null` = not on an OGS TV · the session.

#### `GamePlayer`

```ts
type GamePlayer = { id: string; handle: string; name: string; avatar: string }
```

Someone on the couch. See [Messages and manifest](messages.md#gameplayer).

#### `InstanceReportInput`

```ts
type InstanceReportInput = {
  instanceId: string;
  appId: string;
  status: "lobby" | "active" | "suspended" | "waiting" | "completed" | "expired";
  title?: string;
  detail?: string;
  yourTurn?: boolean;
  startsAt?: number;
  resumeUrl?: string;
}
```

What `reportOgsSitting` takes: an `InstanceReport` whose `title` and `detail` may be left out
(they default to `""`).

#### `InstanceReport`

```ts
type InstanceReport = {
  instanceId: string;
  appId: string;
  status: "lobby" | "active" | "suspended" | "waiting" | "completed" | "expired";
  title: string;
  detail: string;
  yourTurn?: boolean;
  startsAt?: number;
  resumeUrl?: string;
}
```

The parsed report, as sent. Fields: [Messages and manifest](messages.md#instancereport).

#### `Source`

```ts
interface Source<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}
```

An external store, ready for React's `useSyncExternalStore` (or any framework). `getSnapshot` is
stable while nothing changed.

#### `OgsNotification`

```ts
type OgsNotification = { title: string; body: string; url: string; tag?: string }
```

A push as the page hears it (`onOgsNotification`).

#### `PushConsentResult`

```ts
type PushConsentResult = { status: "granted"; handle: string } | { status: "denied" }
```

The player's answer to `requestOgsNotifications`. `handle` is opaque (`ph_…`): it names no device or
profile.

### Lower level (tests and custom wiring)

You rarely need these: the functions above build them for you. They take their dependencies
(an app bridge, a window) as arguments, which makes them easy to test with fakes.

#### `createProfileSource`

```ts
function createProfileSource(opts: ProfileSourceOptions): Source<ProfileSnapshot>
```

The profile store over any app bridge. Waits `timeoutMs` (300 ms) for the bridge's `profile` store
before deciding there is none, and up to `askingTimeoutMs` (5 s) while the app says `asking`.

#### `ProfileSourceOptions`

```ts
interface ProfileSourceOptions {
  bridge: ProfileBridge;
  timeoutMs?: number;
  askingTimeoutMs?: number;
}
```

#### `ProfileBridge`

```ts
interface ProfileBridge {
  isSupported(): boolean;
  getStore(key: "profile"):
    | { getSnapshot(): unknown; subscribe(listener: (state: unknown) => void): () => void }
    | undefined;
  subscribe(listener: () => void): () => void;
}
```

What profile-kit needs of an app bridge (app-bridge-web's `createWebBridge`, or a mock).

#### `ProfileStores`

```ts
type ProfileStores = { profile: { state: ProfileBridgeState; events: { type: "REFRESH" } } };
```

The app-bridge store the OGS app gives a game's WebView.

#### `ProfileBridgeState`

```ts
type ProfileBridgeState =
  | { status: "asking" }
  | { status: "ready"; profile: OgsProfile }
  | { status: "none" };
```

The `profile` store's state: `asking` while the app fetches the game token, `ready` with it, `none`
when there is no profile or no token for this game.

#### `PROFILE_TIMEOUT_MS`

```ts
const PROFILE_TIMEOUT_MS = 300
```

How long to wait for the app's `profile` store before deciding there is none.

#### `ASKING_TIMEOUT_MS`

```ts
const ASKING_TIMEOUT_MS = 5000
```

How long the app may stay `asking` before the game shows its own form.

#### `createSessionSource`

```ts
function createSessionSource(opts: { win: FrameWindow; timeoutMs?: number }): Source<SessionSnapshot>
```

The session store over any window. Listens for `ogs:start` from `win.parent`, posts `ogs:ready`,
and settles to `null` after `timeoutMs` (300 ms) without a start.

#### `SESSION_TIMEOUT_MS`

```ts
const SESSION_TIMEOUT_MS = 300
```

#### `FrameTarget`

```ts
interface FrameTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}
```

Something a page can post to (its parent window).

#### `FrameWindow`

```ts
interface FrameWindow extends FrameTarget {
  parent: FrameTarget | null;
  addEventListener(type: "message", handler: (ev: { data: unknown; source: unknown }) => void): void;
  removeEventListener(type: "message", handler: (ev: { data: unknown; source: unknown }) => void): void;
}
```

The parts of `window` the TV side uses (a fake in tests).

#### `listenForPause`

```ts
function listenForPause(onPause: (paused: boolean) => void, win: FrameWindow): () => void
```

`onOgsPause` over any window.

#### `reportOgsInstance`

```ts
function reportOgsInstance(
  input: InstanceReportInput,
  deps: { bridge: OgsBridge; win: FrameWindow },
): "bridge" | "launcher" | "none"
```

`reportOgsSitting` over any bridge and window. If the bridge is supported but its `ogs` store is not
there yet, it dispatches as soon as the store appears.

#### `OgsBridge`

```ts
interface OgsBridge {
  isSupported(): boolean;
  getStore(key: "ogs"):
    | { dispatch(event: { type: "INSTANCE_REPORT"; report: InstanceReport }): void }
    | undefined;
  subscribe(listener: () => void): () => void;
}
```

What reporting needs of an app bridge.

#### `OgsStores`

```ts
type OgsStores = {
  ogs: {
    state: { reported: string[] };
    events: { type: "INSTANCE_REPORT"; report: InstanceReport };
  };
};
```

The app's `ogs` bridge store: the page reports its sitting, the app posts it to OGS.

#### `createOgsNotifications`

```ts
function createOgsNotifications(opts: OgsNotificationsOptions): {
  request(join?: { handle?: string }): Promise<PushConsentResult | null>;
  listen(handler: (n: OgsNotification) => void): () => void;
}
```

`requestOgsNotifications` and `onOgsNotification` over any bridge and service worker.

#### `OgsNotificationsOptions`

```ts
interface OgsNotificationsOptions {
  bridge: NotificationsBridge;
  serviceWorker?: ServiceWorkerLike;
  timeoutMs?: number;
  newId?: () => string;
}
```

#### `NotificationsBridge`

```ts
interface NotificationsBridge {
  isSupported(): boolean;
  getStore(key: "notifications"):
    | { getSnapshot(): unknown; subscribe(l: (state: unknown) => void): () => void; dispatch(event: NotificationsBridgeEvent): void }
    | undefined;
  subscribe(listener: () => void): () => void;
}
```

What notifications need of an app bridge.

#### `NotificationsStores`

```ts
type NotificationsStores = {
  notifications: {
    state: { answer: { id: string; result: PushConsentResult } | null; last: { seq: number; notification: OgsNotification } | null };
    events: { type: "REQUEST"; id: string; handle?: string } | { type: "LISTENING"; on: boolean };
  };
};
```

The app's `notifications` bridge store: the page asks (`REQUEST`, answered by id in `answer`) and
says whether it listens; a swallowed push arrives as `last` with a growing `seq`.

#### `ServiceWorkerLike`

```ts
interface ServiceWorkerLike {
  addEventListener(type: "message", listener: (ev: { data: unknown; ports: readonly { postMessage(m: unknown): void }[] }) => void): void;
  removeEventListener(type: "message", listener: (ev: { data: unknown; ports: readonly { postMessage(m: unknown): void }[] }) => void): void;
}
```

The parts of `navigator.serviceWorker` the PWA side uses: `sw.js` posts `{ type: "ogs:notification", notification }`
and the page answers `{ handled: true }` on the message's port.

#### `NOTIFICATIONS_TIMEOUT_MS`

```ts
const NOTIFICATIONS_TIMEOUT_MS = 300
```

How long to wait for the app's `notifications` store before deciding this is not the OGS app.

## `@open-game-system/profile-kit/react`

Hooks over the sources above (`useSyncExternalStore`; during server rendering both are `undefined`).
Needs React 18 or later.

### `useOgsProfile`

```ts
function useOgsProfile(source?: Source<ProfileSnapshot>): ProfileSnapshot
```

Who is playing on this device: `undefined` while asking the OGS app, `null` in a plain browser
(show your name form), or `{ id, handle, name, avatar, token }`. `source` defaults to
`getOgsProfileSource()`; pass one in tests.

### `useOgsSession`

```ts
function useOgsSession(source?: Source<SessionSnapshot>): SessionSnapshot
```

On the TV page: `undefined` while waiting for the launcher, `null` when not on an OGS TV, or
`{ players, token, instanceId, mode, room? }`. `source` defaults to `getOgsSessionSource()`.

### Re-exported types

`/react` re-exports these types from the main entry, so a React page needs one import:

#### `OgsProfile` (react)

Same as [`OgsProfile`](#ogsprofile).

#### `ProfileSnapshot` (react)

Same as [`ProfileSnapshot`](#profilesnapshot).

#### `OgsSession` (react)

Same as [`OgsSession`](#ogssession).

#### `SessionSnapshot` (react)

Same as [`SessionSnapshot`](#sessionsnapshot).

## `@open-game-system/profile-kit/server`

For your game's server (Cloudflare Workers, Node 20+, Deno, Bun: anything with `fetch` and Web Crypto).

### `verifyOgsToken`

```ts
function verifyOgsToken(
  token: string,
  opts: { appId: string } & VerifierOptions,
): Promise<GameToken | null>
```

Verifies a game token for your game: the ES256 signature against OGS's key set, `aud === appId`
(a token for another game is rejected), and expiry. Returns the claims, or `null` when any check
fails. The key set is cached per `jwksUrl`; an unknown key id refetches it at most once a minute.
Passing `fetch` or `now` uses a fresh verifier (tests).

```ts
const claims = await verifyOgsToken(token, { appId: "space-bakery", jwksUrl: env.OGS_JWKS_URL });
```

### `createOgsVerifier`

```ts
function createOgsVerifier(opts?: VerifierOptions): (token: string, appId: string) => Promise<GameToken | null>
```

A verifier with its own cached key set, for when you want to hold one explicitly.

### `VerifierOptions`

```ts
interface VerifierOptions {
  jwksUrl?: string;
  fetch?: (url: string) => Promise<Response>;
  now?: () => number;
}
```

`jwksUrl` defaults to `OGS_JWKS_URL`. `fetch` and `now` are for tests.

### `OGS_JWKS_URL`

```ts
const OGS_JWKS_URL = "https://api.opengame.org/.well-known/jwks.json"
```

The built-in default, which has no DNS record yet (checked 2026-10-18). Always set `jwksUrl` from
configuration: in production `https://opengame-api.jonathanrmumm.workers.dev/.well-known/jwks.json`, in seam tests a local key set.

### `GameToken`

```ts
type GameToken = {
  iss: string; aud: string; sub: string; handle: string; name: string; avatar: string;
  sid?: string; players?: GamePlayer[]; couch?: CouchClaim; iat: number; exp: number;
}
```

The claims OGS signs into a game token. `sub` is the profile id (the host's on a TV token); `sid`
and `players` are on TV tokens; `couch` on every token issued for a couch. Never friends, other
games, device ids, push tokens or age. Field table: [Messages and manifest](messages.md#gametoken).

### `CouchClaim`

```ts
type CouchClaim = { sid: string; label: string }
```

The couch a token was issued for: the couch session id and its label (the host's name). Players
with the same `sid` sit on the same couch.
