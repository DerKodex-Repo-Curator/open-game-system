# Lessons Learned

Persistent project knowledge. Review at the start of each task.

## Platform & Framework

- **Wrangler v3 → v4**: Upgrade resolved esbuild/webpack conflicts with vitest. Always use wrangler v4+.
- **D1 upsert pattern**: Use `INSERT ... ON CONFLICT(pk) DO UPDATE SET` for idempotent operations. Works in SQLite.
- **Hono test requests**: Accept env bindings as 3rd argument to `app.request()` — no need for real D1 in tests.
- **Expo push tokens**: Only work on physical devices, not simulators. Use `expo-device` to guard.
- **Expo push handler**: `setNotificationHandler` must be called at module level (not inside a component).
- **EAS Build in CI**: Use `expo/expo-github-action@v8` with `--non-interactive --no-wait`. Android only until iOS creds are set up.
- **Token rotation**: Register an `addPushTokenSubscription` listener to catch OS-level token changes and re-register.
- **Deep links**: Handle both cold start (`Linking.getInitialURL()`) and warm start (`addDeepLinkListener()`) separately.
- **App Bridge stores**: Create at module level, not inside components. Use immer-style producers for state updates.
- **React Native WebView**: The `BridgedWebView` wrapper injects bridge scripts automatically — don't manually inject.
- **tsup with composite tsconfig**: If a package has multiple source files, set `composite: false` in the package tsconfig or tsup's DTS build fails with "file not listed" errors.
- **BridgeStores type constraint**: Use `type` (not `interface`) for store definitions — interfaces lack the implicit index signature that `BridgeStores` requires.

- **Keyboard: React Native's KeyboardAvoidingView is wrong away from the top of the window**: it computes the overlap from its `onLayout` frame (relative to its parent), so inside an onboarding pager page (84 points down) it fell 84 points short and Next stayed under the keyboard. And in a modal sheet (Fabric) even `measureInWindow` measures from the sheet's top, not the display's. `components/ogs/KeyboardFooter.tsx` measures in the window, adds a sheet's offset (sheets sit on the bottom: window height - sheet height), and pins the form's main action in a footer above the keyboard; `Screen` takes a `footer`, and a plain `Screen` uses `automaticallyAdjustKeyboardInsets` (native, window-correct) to scroll a focused field above the keyboard.
- **Every enclosing ScrollView needs `keyboardShouldPersistTaps="handled"`**: a button outside the inner ScrollView but inside an outer one (the onboarding FlatList pager) only closes the keyboard on the first tap, unless the outer one says "handled" too. Same for a horizontal picker inside a form (the sticker row).
- **Fabric: `measureLayout` against `ScrollView.getInnerViewNode()` silently fails**: the error callback runs, so KeyboardFooter's reveal never scrolled (the @id only came into view because UIKit scrolls a newly focused field itself). Measure with `measureInWindow` (native, sees the scroll) and convert: content top = window y - scroll view's window y + scroll offset (`contentTop` in `components/ogs/keyboard.ts`). A field that must show with another (the name with the @id under it) passes it to `useRevealFocused()(ref)`.
- **Detox can't see an InputAccessoryView**: the bar lives in the keyboard's window, which Detox doesn't search; and Detox's `toBeVisible` ignores the keyboard window, so only a `tap()` that creates something proves a button isn't under the keyboard.

## Architecture

- **Error response consistency**: Every API error must use `{ error: { code, message, status } }`. Don't mix formats.
- **Push providers are stubs**: APNs needs Apple .p8 key + JWT signing + HTTP/2. FCM needs Firebase service account + HTTP v1 API. Both are non-trivial integrations.
- **notification-kit bulk send**: Currently sends N individual requests via `Promise.allSettled()`. Needs a batch API endpoint.
- **D1 mocking**: Mock the `prepare().bind().run()`/`.first()` chain with `vi.fn()`. Inspect the SQL string to route different queries to different return values.
- **Observable store pattern (mobile)**: Decouples URL sources from WebView consumer without adding Redux/Zustand.
- **Cast-kit standalone bridge was a mistake**: Building a separate bridge (WebViewBridge, HttpBridge) duplicated app-bridge and caused architecture mismatch in trivia-jam. Casting state is just another app-bridge store. Follow the notification-kit pattern.
- **TV rendering: stream-kit, not browser-on-TV**: Chromecast's built-in browser is slow and limited. Server-side rendering via stream-kit + WebRTC video streaming gives consistent quality. The TV receiver is just a `<video>` element.
- **SDK components should be headless**: Styled components (CastButton, etc.) belong in the consuming app, not the SDK. SDKs export hooks and types; apps compose the UI.
- **The Cloudflare container is gone (2026-10-06)**: streaming renders only on Cloud Run (`stream-gpu`), named by `STREAM_SERVER_URL`; the image builds from `services/api/container` (server.ts, Dockerfile, its tsx tests), which the Worker build never touches. `StreamContainer` was removed with a `v3` `deleted_classes` migration (keep v1/v2: migrations are append-only), and `wrangler deploy`/`wrangler dev` no longer build Docker. Still on Cloudflare until the owner deletes them: the `codeflare-containers` container application and the `bun-stream-server` Worker. The three container lessons below are history.
- **Cloudflare Containers: can't add to existing Worker**: Deploying a Worker with `containers` config creates a container image registry tied to that Worker name. If the registry wasn't created with the Worker originally, it won't auto-create later — even after deleting and recreating the Worker. The DO metadata also persists across Worker deletion and requires explicit `deleted_classes` migration. Keep containers on their own Worker until Cloudflare fixes this.
- **Cloudflare DO metadata survives Worker deletion**: `wrangler delete` removes the script but not the Durable Object class registry. Redeploying without the DO class requires a `deleted_classes` migration in wrangler.toml. Once the migration runs, the entries can be removed.
- **Cloudflare container registry is per-Worker and can't auto-create**: The registry was provisioned during beta onboarding for `bun-stream-server`. New Worker names get "The image registry does not exist" — both locally and in CI. Not an OrbStack issue. Workaround: reuse the existing Worker name, or file a Cloudflare support ticket to provision a new registry.
- **Dual React with `link:` dependencies**: When a consuming app uses `link:../monorepo/packages/foo`, the linked package resolves React from its own `node_modules/`, not the consumer's. This causes "Cannot read properties of null (reading 'useMemo')" crashes. Fix: add Vite `resolve.alias` to force React resolution to the consumer's copy.

## Testing

- **Jest + Expo**: Requires `jest-expo` preset and careful `transformIgnorePatterns` to allow `@open-game-system/*` packages through.
- **Stryker mutation testing**: Track surviving mutants. Log-string mutants are acceptable survivors.
- **Vitest workspace**: When adding a new package with tests, add its vitest config to the workspace if using a shared vitest workspace file.

- **A hook that derives state from props must return the same object when nothing changed**: the launcher's `nextFrames` returned a fresh `{active:null, parked}` every render while a game waited for its TV view, the effect saw "new frames" and looped ("Maximum update depth exceeded"). Pure reducers feeding `useEffect`/`setState` need an identity test.
- **The e2e framework pins its own Playwright**: `@e2e-dev/web` uses playwright-core 1.63 (Chromium build 1243), separate from the repo's Playwright. If `playwright install` times out, download the Chrome for Testing zip it names and unzip into `~/Library/Caches/ms-playwright/chromium-<build>/` with `INSTALLATION_COMPLETE` + `DEPENDENCIES_VALIDATED` markers.
- **Screenshot after the cut-over, not after the DOM**: the launcher's box↔fullscreen transition runs after the state change; wait for `[data-testid=player][data-phase=hidden]` before capturing home.
- **Game art for the launcher: crop out the HUD**: game screenshots carry HUD rows and faced UI props (smiling planets/stars). Manifest `art.safe` (scale + origin) crops them; check every hero/tile by eye.

- **`wrangler dev` hot-reloads from the working tree**: the shared local API (8788) runs from `services/api`, so a commit (or even a save) there reaches it immediately, against its old local D1. A schema change then breaks the owner's running app. Run your own copy with `--port <other> --persist-to <scratch dir>` and restart the shared one (wiping `.wrangler/state/v3/d1`, `pnpm db:local`) only when you mean to.
- **Sign-in tests use vercel-labs/emulate, not real providers**: Apple/Google ID tokens come from `POST /auth/authorize/callback` (Apple) or `/o/oauth2/v2/auth/callback` (Google) with a seeded user's email, then the token endpoint. Apple's `email_verified` is the string `"true"`, Google's a boolean. Workers in vitest-pool-workers can fetch the emulators on localhost.
- **Email (Cloudflare Email Service) needs no emulator locally**: `wrangler dev` (4.147+, miniflare 5) simulates a `send_email` binding: nothing is delivered, `send()` returns a `messageId`, the text/html land under `.wrangler/tmp/email/`, and the Local Explorer lists every sent message (to, subject, sentAt; `?email_id=` adds text/html) at `GET http://localhost:<port>/cdn-cgi/local/explorer/api/local/email/sending`. It answers only a localhost `Host` (403 otherwise) and lists mail from every local dev session, so filter by a unique `to`. vitest-pool-workers turns the Local Explorer off, so integration tests replace the binding: `miniflare.email = { send_email: [] }` (the pool merges objects with `Object.assign`, so this drops wrangler's binding) plus `serviceBindings.SEND_EMAIL` → a recording `WorkerEntrypoint` auxiliary worker. Send `from` as `{ email, name }`; the address must be in `allowed_sender_addresses` and on a domain onboarded to Email Sending.
- **New tables: apply them to the shared local D1 right after committing**: friends (slice 2) added `profile_seen`, written by `anyToken` on every phone/tablet call, so the shared 8788 (hot-reloaded from the tree, old D1) answered 500 to every authed call until the schema was applied. After any schema commit run `cd services/api && pnpm db:local` (only `CREATE ... IF NOT EXISTS`, never drop or wipe the shared DB), and keep schema changes additive (new tables over new columns, since `CREATE TABLE IF NOT EXISTS` never adds a column to an existing table).

- **"Newest first" in SQLite needs a tiebreak that moves on every write**: `ORDER BY updated_at DESC, rowid DESC` flipped under load because two writes in one millisecond tie on `updated_at` and `ON CONFLICT DO UPDATE` keeps the row's old rowid. `INSERT OR REPLACE` gives each write a fresh rowid (max + 1), so `rowid DESC` is the most recent write; tests freeze `Date.now` to pin the tie.

- **CRAP of services/api needs Node-side route tests**: coverage from the workerd integration suite can't be collected (`@vitest/coverage-istanbul` fails inside vitest-pool-workers with "template is not a function"). `test/support/d1.ts` gives Node tests a real local D1 (wrangler `getPlatformProxy`, schema.sql applied, `reset()` between tests), so `app.request(path, init, { DB })` route tests are measured. Measure with `scripts/crap.mjs` (AST-based); the regex crap4ts misses inline Hono handlers.

- **Inlining a workspace package with tsdown: prefer its ESM build**: profile-kit bundles app-bridge-web (main = cjs, module = esm, no `exports` map). Rolldown resolved `main`, inlined the CJS and emitted `import { createRequire } from "node:module"` for its `require("fast-json-patch")`, which breaks every game's esbuild browser bundle. Set `inputOptions.resolve.mainFields: ["module", "main"]`; `src/dist.test.ts` bundles the dist with esbuild `platform: "browser"` and fails on any `node:` import.
- **Games get packages from packed tarballs**: ogs-protocol and the workspace app-bridge versions are not on npm, so a package games install (profile-kit) bundles them (`deps.alwaysBundle`) and keeps only npm deps (zod, fast-json-patch, react) external. Re-pack with `pnpm pack` and re-vendor with `pnpm install --force` (same file name, new integrity).
- **Game tokens never touch the app token**: the game WebView gets a token for that game only (`profile` bridge store); the TV page gets the session's game token in `ogs:start`. A frame that attaches its listener after `load` says `ogs:ready` and the launcher re-sends the start.

## Process

- **Monorepo consolidation (2026-03-13)**: Merged 5 repos. Key issues were import path changes (`app-bridge` → `app-bridge-web`/`app-bridge-react`), vitest version mismatches (v4 needs vite v6+), and React types version conflicts across packages.
- **README is aspirational for notification-kit**: The README documents planned features not yet built. Grow code toward the README, not vice versa.

- **Metro caches EXPO_PUBLIC_* values between Release builds**: switching `EXPO_PUBLIC_FAKE_CAST` (or any EXPO_PUBLIC_ value) between builds is silently ignored when Metro reuses its cache. Build with `EXTRA_PACKAGER_ARGS=--reset-cache` whenever env values change.
- **Codex as a design judge**: `codex exec` needs `--skip-git-repo-check` outside the repo root, and the prompt must go in on stdin when images are passed with `-i` (with `-i … "prompt"` it hangs on "Reading prompt from stdin").
- **One name for a sitting, phone and TV**: `sittingName` in `@open-game-system/ogs-protocol` (resume point, else "Started 7:42 PM") is the only rule; the phone's `sitting-title.ts` and the TV's `launcher/layout.ts` both call it. ogs-protocol is consumed from `dist/`, so `pnpm --filter @open-game-system/ogs-protocol build` after changing it. On the TV home each fact is said once: the focused game's status and tagline only in the spotlight (`launcher/facts.ts`), never on its card.
- **Deploying the API (2026-10-04)**: deploy from a clean `git worktree` at HEAD. (Until 2026-10-06 `wrangler deploy` also built the Cloudflare container image with Docker; it no longer does. For a local Docker build of the Cloud Run image that hangs at 0% CPU, the `desktop` credential helper is stuck: build with `DOCKER_CONFIG=<dir>` whose config.json has only `currentContext` and `cliPluginsExtraDirs: ["~/.docker/cli-plugins"]` (buildx).) `git push` of this branch needs `git -c http.postBuffer=1048576000 push` (HTTP 400 otherwise). The launcher deploys with `pnpm --filter @open-game-system/tv run deploy` (without `run`, pnpm runs its own `deploy` command) (Pages project `ogs-tv`).
- **Show a user's action at the tap, not at the reply (2026-10-04)**: Stop casting waited on `endCurrentSession` (the fake Chromecast's `/stop` replies only after it closes the page and saves its video, ~2 s; a real Cast session ends asynchronously too), so the remote lingered. `services/cast-stop.ts` marks the stop at the confirm and clears it once the cast is gone (a failed stop brings the remote back). To time this in Detox, `device.disableSynchronization()` around the check: with sync on, Detox waits for the pending fetch before it looks. To see a sub-second UI flash, record (`xcrun simctl io <sim> recordVideo`), extract every frame (`ffmpeg -fps_mode passthrough … f_%06d.png`; `-frame_pts` names collide) and OCR them with `tesseract`.
- **Onboarding pager**: `scrollToIndex({ animated: true })` across two pages shows the page in between; `animatesMove` slides only to the page next door and jumps otherwise.
- **Which renderer a cast uses (2026-10-05)**: the phone names the stream server in LOAD_VIEW (`streamServerUrl` = `EXPO_PUBLIC_OGS_STREAM`, else `<EXPO_PUBLIC_OGS_API>/api/v1/stream`); the receiver (opengame.org/receiver, Pages project `opengame-org`, deploy with `--branch main`) only falls back to its own default. The API then forwards to `STREAM_SERVER_URL` (the Cloud Run GPU `stream-gpu`, project `opengame-stream`, us-east4: L4, scale to zero, maxScale 1); unset, it answers `stream_not_configured` (the Cloudflare Container fallback was removed 2026-10-06). The real casts before this went through the PR-5 preview Worker (hard-coded) while production pointed at `bun-stream-server` (a March Worker); production CI no longer forces that. The GPU publisher on Cloud Run reaches the SFU through TURN (only host + relay candidates in its logs), so the API needs `CLOUDFLARE_TURN_API_TOKEN`/`CLOUDFLARE_TURN_KEY_ID` too.
- **The idle stop reads the top page**: the renderer evaluates `window.__ogsActivityAt` on the page it streams, which for a cast is the launcher (games are cross-origin iframes it can't see into). The launcher keeps it fresh while any phone/tablet is online on the couch session, on any session change and on remote presses (`apps/tv/src/session/activity.ts`); `apps/tv/e2e/idle.e2e.ts` checks it with the renderer's own `isIdle` on a Playwright virtual clock.
- **opengame.org was deployed from `main`, not this branch**: before deploying apps/web from a branch, diff `apps/web` against the commit of the live Pages deployment (`wrangler pages deployment list --project-name opengame-org` shows it) so laptop-cast fixes on main aren't rolled back.
- **Launcher themes (2026-10-04)**: an `<audio>` element's `src` reads back absolute (`http://…/art/x/theme.mp3`), so the theme player (`apps/tv/src/ui/theme-player.ts`) keys a theme by the URL it was asked for, never `el.src`. The theme loops (`apps/tv/public/art/<appId>/theme.mp3`) are cut from each game's own music with no paid service: the produced lobby beds where a game has them (rocket-crew, bake-shop, story-nook `public/audio`), else the in-code synth score played in headless Chrome (`--autoplay-policy=no-user-gesture-required`) by bundling the game's `audio-engine.ts` + `music.ts` with esbuild and recording `graph.out` with a ScriptProcessor (no game repo edits). A loop is a window of a whole number of chord cycles (synth) or the best repeating lag (beds), its first 1.5 s equal-power crossfaded with what follows the window, so the end runs into the start; MP3 128 kbps, RMS −20 dBFS. MP3, not AAC: open-source Chromium builds may lack AAC, and the cloud renderer's Chrome is not verified to have it. Port 5190 may be taken by the repo-root e2e: `TV_E2E_PORT=5197 pnpm test:e2e`.

## Google Cast session timing (2026-10-05)

- **`endCurrentSession` resolves before the session has ended**: react-native-google-cast's iOS
  bridge (`RNGCSessionManager.m`) calls `endSessionAndStopCasting:` and resolves at once; the session
  stays `currentCastSession` until `didEndCastSession` (our `onSessionEnded`). And
  `startSessionWithDevice:` answers NO "if there is a session currently established" (GCK docs),
  which the bridge resolves as `false`. So "end, then start" must wait for the ended event, or the
  start is refused silently: the owner's flaky TV switching ("sometimes it works… sometimes it
  eventually works"). `cast-flow.ts` `endSessionAndWait` subscribes before asking, with a timeout.
- **The fake Cast backend was kinder than the real one**: it awaited the TV's `/stop` and fired
  ended before `endCurrentSession` resolved, and replaced a running session on start, so tests and
  Detox never saw the bug. `EXPO_PUBLIC_FAKE_CAST_END_MS` (fake `endedAfterMs`) models the real
  timing; `EXPO_PUBLIC_FAKE_CAST_URL_2` gives the Bedroom TV its own fake Chromecast.
- **The remote unmounts mid-switch**: between the old session ending and the new launcher joining,
  `ogsCastNow()` is false, so the TV tab swapped to the Cast screen and the picker's error state
  vanished with the component. A flow that spans an unmount keeps its state outside React
  (`cast-switch.ts`, like `cast-stop.ts`).
- **app-bridge stores call a new subscriber at once**: `subscribe(fn)` runs `fn(current)` before
  it returns its unsubscribe, so a listener that unsubscribes itself on the first call must not
  use the returned function yet (`cast-switch.ts` `connected`).
- **Logs before guesses**: client events go to `POST /api/v1/client-events` → Workers Logs. To read
  a real-device switch: Workers Logs, filter `kind = client_event` and `attemptId`; a failed switch
  is `cast.switch.done` level error, and its `cast.end.waited` / `cast.start.resolved` say why.
- **A WebRTC picture doesn't keep Google TV awake (2026-10-10)**: on the owner's Chromecast with
  Google TV the screensaver (Ambient mode) came on ~5–6 min into a game and the cast died under it
  (Workers Logs: `receiver.stream.started`, no `receiver.cast.ended`, a new cast 6 min later). The
  receiver plays a WebRTC MediaStream in a plain `<video>` with no Cast media session, so the device
  sees nothing playing; `disableIdleTimeout` only keeps Cast from closing the receiver app, it does
  not stop the screensaver. The receiver now holds a Screen Wake Lock while a stream plays (taken
  again on its `release` and on `visibilitychange` → visible) and falls back to a 16×16 looping
  muted clip (`keepawake.mp4`/`.webm`, the NoSleep.js way) when the API is missing or refuses.
  Which one holds on a real TV is in the logs (`receiver.keepawake`, `receiver.visibility`); an
  e2e fake can't prove a device stays awake. Any new cast surface that plays WebRTC needs the same.
- **Cast must look at the session before it starts one (2026-10-10)**: the cast prompt said "<TV>
  didn't answer. Is it on?" while casting worked. Workers Logs: attempts 21cf-6, 24fr-7, t8ol-8
  each had `cast.start.requested` then `cast.start.resolved {started:false}` 12–15 ms later, with
  `cast.load_view.sent {reason:"change"}` just before (the new launcher going to a session already
  up). The prompt shows whenever the phone isn't cast *through OGS*, which can be true while a Cast
  session is up or resuming; `castToTv` then asked for a start, Google Cast answered NO
  ("a session currently established") and `false` became "no-tv". `castToTv` now reads the store's
  session (and the SDK's current session when the store names no TV): same TV connected → no
  start; connecting → wait for connected; another TV → end, wait for ended, start; a start refused
  with a session up is `refused-session-active`, not "didn't answer". One Cast at a time
  (`cast-once.ts`). LOAD_VIEW now carries the phone's `attemptId` and the couch `sessionId`, which
  the receiver logs on every event as `phoneAttemptId` / `sessionId` (recipe:
  docs/agents/observability.md). The fake's `refuseWhileActive`
  (`EXPO_PUBLIC_FAKE_CAST_REFUSE_ACTIVE=1`) refuses a start while a session is up, as GCK does.

## e2e (2026-10-04, Cast receiver)

- **Reaching Playwright from a tester-army test**: `surfaceOf(engine)` only knows the engine instance the runner drives, and the runner and the test file load `e2e.config.ts` separately (two instances: "no attempt is running"). The config keeps one instance on `globalThis.__ogsWebEngine` and exports it; call `surfaceOf(webEngine).page()` only after the first `browser.goto` (the attempt opens lazily). `context().newPage()` gives a second page (the laptop / SFU peer) under the same `browser.route` handlers.
- **tsx wraps named inner functions in `__name()`**: a `page.evaluate` callback that declares `const f = () => …` throws `ReferenceError: __name is not defined` in the browser. `receiver-kit.ts` adds `globalThis.__name = (fn) => fn` as a context init script.
- **Loopback WebRTC between two pages of one Playwright Chromium works with no STUN/TURN**: create the offer, wait for `iceGatheringState === "complete"`, pass the SDP; frames arrive in under a second (`requestVideoFrameCallback`).
- **Playwright's clock is per context and `runFor` replays every timer**: with a 30 fps canvas publisher in another page, `runFor(3 min)` took 27 s and 3 hours never finished. Step `fastForward(1 min)` instead (each due timer fires once per step, so a 1-minute heartbeat still counts right). The clock also runs with real time: allow for the seconds a WebRTC answer takes before asserting a 20 s timeout.
- **A receiver stop must end the heartbeat itself**: the heartbeat is what keeps a GPU stream server up. A failed start, the no-phone stop and the 3-hour cap now all stop it (`endCast` / `cleanup`), instead of trusting `context.stop()` to close the page.
- **Production API had no TURN on 2026-10-04**: `pnpm stream:ready https://opengame-api.jonathanrmumm.workers.dev` got only the STUN fallback from `/stream/ice-servers` (the PR-5 preview returns 6 TURN urls). The GPU publisher reaches the SFU through TURN, so set `CLOUDFLARE_TURN_API_TOKEN` / `CLOUDFLARE_TURN_KEY_ID` on production before casting through it.

## Several households, one room (2026-10-05)

- **A local API copy needed `--enable-containers=false` (until 2026-10-06)**: `wrangler dev` built the
  stream container image with Docker and then hung every request. With the container removed, plain
  `wrangler dev` (and `pnpm dev:local`) starts no Docker build.
- **A joining household's phone must declare its own TV page**: Night Flight only rendered
  `useCastViewUrl` for the room's host, so the Smiths' phone joined the room but their TV never framed
  it. In a multiCouch game, every phone that started its couch's TV (`?tv=` on Night Flight) declares
  it, host or not. The e2e found this; the unit tests could not.
- **actor-kit's DO `send` RPC type has no `caller`, but the machine reads it**: the worker passes a
  service event built in a variable (`{ ...event, caller: { type: "service" } }`) so the room's guard
  can tell OGS (a verified token) from a client, without a cast. Its HTTP router sends any event with
  the client's caller, so guards on service events must check `caller.type === "service"`.
- **Phone pages in a fake OGS WebView for cross-surface e2e**: `window.ReactNativeWebView` answering
  `BRIDGE_READY` with `STATE_INIT` for `cast`, `ogs` and `profile` (a real game token from the local API)
  gives a game page everything the app gives it; read `SET_VIEW_URL` from what it posted and send
  `game.view` to the couch, as the app does (`e2e/multi-couch.mjs`).
- **Playwright never sees a bobbing card as "stable"**: Night Flight's playable cards animate, so the
  e2e clicks them with `{ force: true }`.
- **Record launchers at 960×540** (`recordVideo.size`) to keep the files small. (An older note here
  said a 1280×720 viewport "crops" the launcher: that was the stage-centring bug below, not a rule.)
- **Never centre a fixed-size, scaled stage with grid/flex** (`apps/tv` Stage, 2026-10-05): a 1920×1080
  grid item in a smaller viewport overflows from the top-left, so `scale()` about its centre left the
  launcher 25% down and right and running off the TV at 1280×720, which is the size the cloud renderer
  draws (`STREAM_VIEWPORT`). Every launcher e2e ran at 1920×1080, where it happens to work. Position it
  (`left/top: 50%`, `translate(-50%, -50%) scale(s)`), and test every screen at 720p, 1080p and 4K
  (`apps/tv/e2e/viewports.e2e.ts`: every visible element inside the 5% TV-safe area). A focus
  `scale()` on an element sitting on the safe line grows past it: scale away from the edge.
- **ffmpeg `xstack` with a `color` filler runs forever**: cap the output with `-t` (the longest tile's
  offset + length), or a 3-tile run never ends.
- **Detox reloads the app before every test** (`e2e/setup.ts`: `beforeEach` → `reloadReactNative`), and
  a cold start opens Library unless this phone is playing. A phone that must stay on a screen while
  another process works (multi-couch's Mumm phone on Playing) waits inside the same `it`. The jump looked
  like an app bug in the video; a revert of a "fix" in `app/index.tsx` records the mistake.
- **A stuck `simctl io recordVideo`** ("Host recording is already in progress") survives a killed parent:
  shut the simulator down and boot it again before the next recorded run.

- **The Cast receiver must never show anything a sender didn't ask for (2026-10-05).** `receiver.html` used to fall back to `https://triviajam.tv` on the production stream server when no LOAD_VIEW arrived within 8 s. A slow launcher token or a racy TV switch on a real phone hit that window, so the TV opened an old game (and started a cloud stream nobody asked for). It now waits and keeps sending REQUEST_VIEW; only a `?viewUrl=` in the receiver's own URL starts a view without a sender.
## One start, one sitting (2026-10-05)

- **A game's bridge report labels OGS's sitting, it doesn't make one**: every game reports its sitting from
  the phone page with its own id (`story-nook:XJNE`, `rocket-crew:KQTP`), while a cast start opens the couch
  session's sitting (`story-nook-<time>`). The app posted the phone's report under the game's id, so one
  Play was two sittings on the game's page ("Game 1", "Game 2", same minute). The launcher already used
  the TV's `ogs:instance` only as a label; the app now files a bridge report under the couch's live sitting
  of that game (`reportSittingFor`), and under the game's id only when playing on the phone alone.
- **Detox on iOS can't match a RegExp id**: `by.id(/^gameSitting-/)` reaches the app as the literal string
  and finds nothing (`by.text` inside a Pressable with an `accessibilityLabel` finds nothing either). Check
  ids by name. `games-know-you.test.ts` waited on such a RegExp (and on `rocket-crew:<room>`, which since
  one-start-one-sitting is the couch's id) until 2026-10-07: read the id from the API first
  (`castSittings` in `e2e/helpers.ts`), and match a Pressable by its `by.label`.
- **Changing where phones go breaks Detox files that are only run by a driver script**: phones-follow
  (2026-10-06) opens the game on every couch phone, so `multi-couch.test.ts`'s Mumm phone was in Night
  Flight with no tabs when it tapped Playing. After a change to the couch session's follow, run
  `e2e/multi-couch.mjs` and `e2e/phones-follow.mjs` too (docs/testing/e2e.md, "The whole Detox suite").
- **A button's look in Detox: read the pixels**: Detox exposes no colours. `element.takeScreenshot()`
  gives the element's PNG; the share of fill-colour pixels (pngjs) tells filled (Start game ~ most of it
  lamp) from outlined (none). On the web, `innerText` counts text under an opaque overlay (the TV's game
  page over Home's spotlight): count what is on screen with `elementFromPoint` at each text's middle.
- **A fresh worktree runs nothing until the packages are built**: `wrangler dev` (API) and `vite build`
  (launcher) resolve `@open-game-system/*` to `dist/`; run `pnpm exec turbo run build --filter="./packages/*"`
  after `pnpm install`.
- **Story Nook's start page makes a room it never uses**: in the app `/` redirects to `/tv/<new code>`
  (spawning that room) before the page sends itself to `/host`, which makes the real one. Invisible to OGS
  (that room never reports), but every start leaves an empty room behind.

- **Detox synchronization hides transient states (2026-10-06).** With it on, a tap only returns once
  the app is idle, so a TV switch had already finished by the time the test looked for "Switching to
  <TV>…" (and a mid-switch reopen of the sheet was impossible). `tv-switch.test.ts` turns it off for
  the switch (`device.disableSynchronization()`) and waits out the sheet's slide in and out by hand
  (retry the Change tap, a short settle before tapping a row), then turns it back on.
- **`e2e/setup.ts` reloads the JS before every Detox test, and the fake Cast session lives in JS.**
  A real phone keeps its native Cast session across a reload; the fake doesn't, so a second test in
  the same file starts with the couch still cast but no Cast session to end, and its first switch
  is instant. Keep a TV-switch scenario in one `it`.
- **The fake Chromecast handles `/load` and `/stop` in order.** A switch superseded mid-way stops a
  TV whose `LOAD_VIEW` is still being opened; closing the recording context under that load left
  the app's request open forever, and Detox (waiting for the app to be idle) hung until the test
  timed out. `e2e/fake-chromecast.mjs` now queues them, and `goto` has a timeout.
- **The fake's second TV must arrive even if discovery is restarted.** `startDiscovery` used to
  restart the 1.5 s trickle on every call, so searches close together could keep "Bedroom TV" out
  of the list ("No other TVs nearby"). A search while it is on its way now keeps its arrival.
- **The Detox remote root (`tvRemote`) is not "visible" on an iPhone 17 Pro**: the tab bar covers
  more than Detox's 25% allowance. Wait on an element in it (`remoteTvName`).

## Every couch phone follows the TV (2026-10-06)

- **A follower must wait for the room**: the phone that starts a room-based game (no static `tvUrl`)
  makes the room from its start page; the TV page reports it (`ogs:room` → `game.room`) only after the
  launcher frames it. A second phone that opened the plain start page at `game.start` made its own,
  empty room, and its own `game.start` was swallowed (`alreadyOn`). The couch session re-sends the
  follow when the room is named; the app (`couch-follow.ts`) opens nothing until then, and tapping the
  live game opens `startUrl?ogsRoom=<room>` (`launch-plan.ts` `liveRoom`). A game that never reports
  its room gets no followers.
- **A follower's swipe back must not send home**: every game screen sent `home` on leaving while cast,
  so one kid stepping out parked the game for the whole couch. Leaving parks only for the game's host
  (or when nobody hosts it); the TV going Home closes followers' screens without a `home`.
- **Rosters are never sent**: no client fills `game.start`'s `roster`, so kids' iPads, which followed
  only by roster seat, stayed on the remote when a game started. Tablets now follow like phones (seat
  when there is one, else `"player"`); never key a device's behaviour on data no client sends.
- **A follower's page asks for its TV view too**: a phone or iPad that follows into a room game runs
  the same phone page, whose `useCastViewUrl` the app forwards as `game.view`, and the launcher would
  reframe the TV with the follower's page. The DO stamps `game.view` with the sender and the reducer
  takes it only from the sitting's host (any device when nobody hosts).

## Observability (2026-10-05)

- **Hono logs unhandled errors itself**: without `app.onError`, Hono answers a plain-text 500 and calls `console.error(err)`, a second, unstructured error line next to the wide event. `app.onError` answers the error contract and the `wideEvent` middleware reads `c.error` (Hono sets it before `onError` runs), so each failure is one line.
- **Request lines use `console.info`, client-event lines `console.log`**: the client-events tests spy on `console.log` and expect exactly the client lines, so the request middleware writes its ok line at info level (Workers Logs level `info`). Errors from both go to `console.error`; sre-agent reads only error level.
- **`routePath(c, -1)` (hono/route) gives the matched pattern in middleware**: log it, never `c.req.path` (ids) or the URL (couch WebSocket upgrades carry `?token=`).
- **A Worker module needs a `scheduled` export for its cron (2026-10-06).** `services/api` exported the Hono app as default (fetch only) and `handleScheduled` by name only, so its `*/5` cron failed every run with "Handler does not export a scheduled() function" from April until sre-agent's first dry run caught it. The handler only aged rows in the v1 `cast_sessions` table, which nothing writes any more (the app stopped calling `/api/v1/cast/sessions`), so the cron and `scheduled.ts` were removed rather than wired. Removing the `triggers` key is not enough: wrangler keeps the deployed crons unless the config says `"triggers": { "crons": [] }`. If a cron comes back, export `{ fetch: app.fetch, scheduled }` and test the default export, not the named handler.
- **Installing the renderer (`services/api/container`) locally (2026-10-06)**: it is outside the pnpm workspace (`services/*` matches only `services/api`) and its image builds from `package-lock.json` (puppeteer 24.20.0, Chrome 140). A plain `pnpm install --ignore-workspace` without a lockfile resolves a newer puppeteer whose Chrome isn't installed ("Could not find Chrome (ver. 148…)"); `pnpm import --ignore-workspace` first keeps the pinned versions (leave the generated `pnpm-lock.yaml` uncommitted). Its tab-capture publisher returns its offer without waiting for ICE gathering (no candidates; fine for an ice-lite SFU); a loopback receiver on the same machine still connects, since the receiver's answer carries candidates and the renderer learns its address peer-reflexively (`e2e/tests/stream-pipe.e2e.ts`).
- **A relaunched renderer Chrome can load the extension page without its APIs (2026-10-06)**: after the renderer closes Chrome (idle or lifetime stop) and the next cast relaunches it at once, Chrome loaded `streaming.html` with its script but without `chrome.tabs`/`chrome.tabCapture` on 12 of 40 local relaunches (the page appeared late; closing `about:blank` was not the cause), and that prepare failed with "Cannot read properties of undefined (reading 'query')". A cold boot (Chrome prelaunched at server start) never showed it. `ensureExtensionApis` (`services/api/container/src/extension-page.ts`) probes the page for its script and APIs and reloads it when the APIs are missing (0 failures in 40 after). Guarded by `e2e/tests/stream-pipe.e2e.ts` (8 relaunches in a row).

## Game push (2026-10-08)

- **Stryker's per-test coverage misses D1-proxy route tests.** `services/api` tests that open a local D1 with `getPlatformProxy` (test/support/d1.ts) and call the Hono app kill mutants when run by hand, but Stryker's default `coverageAnalysis: perTest` reported them as survivors (`revokeGrant`, `markOgsActive`). Run `stryker run --coverageAnalysis off --mutate <files>` for those modules.
- **Never call src code from a Stryker setup file.** `test/integration/setup.ts` (a setupFile of `vitest.mutation.config.mts`) hashed the seeded API key with src's `hashApiKey`; a mutant that throws there breaks setup, and Stryker's vitest runner reports a broken setup as "survived". Setup files compute what they need themselves.
- **Mount routers with their own auth before a router that guards `*`.** `games.use("*", anyToken)` runs for every path under `/api/v1/games`, so the game push router (API-key auth) is mounted before it in `src/index.ts`.
- **actor-kit 0.52 declares CONNECT / DISCONNECT system events but never sends them.** To know which callers have the room open (Pocket Draft's "skip connected seats"), the Room DO reads its own hibernatable sockets (`state.getWebSockets()`, each attachment's `caller`) and stamps every event with `connected`.
- **Playwright's default headless Chromium shell has no notifications.** `registration.getNotifications()` stays empty there; launch `chromium.launch({ channel: "chromium" })` (full Chromium, new headless) to test a service worker's `showNotification`. Push a synthetic message with DevTools `ServiceWorker.deliverPushMessage` (`packages/notification-kit-web/e2e/sw.e2e.ts`).
- **Ask for web push permission before any network wait.** iOS shows `Notification.requestPermission()` only from a user gesture; awaiting a fetch or a service worker registration first can lose the tap. `subscribeOgsPush` asks first.
- **@block65/webcrypto-web-push sends `method: "post"` (lowercase).** fetch accepts it; tests that compare the method must not expect `"POST"` exactly.
- **A stall timer added to an actor-kit room's `public.wakeAt` changes the public context every test pins.** Keep server-only wake-ups in a private view for the alarm's own service caller (`private["room-alarm"]`, `getSnapshot(ALARM_CALLER)`), and have the DO set its alarm from both.
- **Safari never lets a service worker skip a push's notification.** WebKit revokes the subscription after three pushes that show nothing ("Enforce silent push quota"; Discourse lost iOS subscriptions skipping notifications for active users). `sw.js` still tells a focused page, but on WebKit (`mustShowEveryPush`) it always shows the notification too.
- **In headless Chromium, read a worker's notifications inside the worker.** The page's `(await navigator.serviceWorker.ready).getNotifications()` intermittently came back empty while the worker's own `registration.getNotifications()` listed them; `context.serviceWorkers()[0].evaluate(...)` is reliable.
- **No phone had ever registered for pushes (found 2026-10-09).** `services/notifications.ts` posted the Expo token to a hard-coded `https://api.opengame.org`, which has no DNS record, and under its own random `ogs_device_id`, while the API finds a profile's phones through `profile_devices` (the profile's device id). Registration now uses `config.apiBase` and the profile's device id, once the profile exists (`services/push-registration.ts`). Check `SELECT … FROM devices` in production before trusting any push path.


## Android (2026-10-18)

- **On Android, react-native-webview's `postMessage` fires the page's `message` event on `document`, not `window`** (`RNCWebViewManagerImpl.kt`: `document.dispatchEvent(event)`, no bubbling). iOS fires it on `window`, where app-bridge-web listens. So in the Android app no game ever got a bridge store: Rocket Crew asked "Who's playing here?" and the TV said it couldn't open. `BridgedWebView` now hands the bridge a target that injects `window.dispatchEvent(new MessageEvent("message", …))` on both platforms (`windowMessage`), so already-deployed games work with no rebuild. Found by the stranger funnel e2e on an emulator; nothing iOS-only catches it.
- **Android onboarding has no notifications page** when Android already allows notifications; Detox walks tap Maybe later only when it shows.
- **`assembleAndroidTest` across every module fails dexing expo-eas-client**: build only `:app:assembleRelease :app:assembleAndroidTest`.

## Shell package (2026-10-18)

- **`jest.mock("<native module>")` only intercepts a workspace package's import of it when both resolve to the same `.pnpm` folder.** Jest keys mocks by resolved real path. A package that imports `react-native-google-cast` must declare it as a peer **and** a devDependency with apps/mobile's exact specifier, and must also pin the dependencies that pick a peer variant: `expo` resolved to a second `.pnpm` folder in `packages/shell` (`@expo/dom-webview@57.0.1` and `react-dom@19.2.4` as its peers) until the shell added `@expo/dom-webview: ^55.0.6` and `react-dom: 19.2.0` as devDependencies. A new importer can also resolve the same specifier to a newer version than the lockfile has for the app (zod 4.4.3 vs 4.3.6); pin it in the lockfile to the app's version. `apps/mobile/services/__tests__/shell-resolution.test.ts` checks specifiers and real paths.
- **A moved module keeps apps/mobile's tests unedited through a one-line shim** (`export * from "@open-game-system/shell/modules/<name>";`): relative `jest.mock("../x")` of a shimmed module still replaces the shim (and every app import of it), but NOT the shell's internal imports of that module. Modules that app tests mock by relative path (deep-links, via `link-routing.test`) stay in the app.
- **Moved code leaves apps/mobile's coverage and Stryker scope** (`collectCoverageFrom` and `mutate` are `services/**` under apps/mobile). Its tests still run there; measure the shell's coverage/mutation from packages/shell.
- **Mutation-testing the shell with apps/mobile's tests needs a particular setup** (`packages/shell/stryker.config.mjs`, `jest.mutation.config.js`): `inPlace: true` (apps/mobile imports the shell's real src, never a sandbox copy); Stryker run from packages/shell (it silently ignores `mutate` globs outside its cwd: "did not result in any files"); the jest worker `chdir`s to apps/mobile (its tests read app.json/package.json from the cwd, and Babel rooted at packages/shell applies the shell's babel.config.js to react-native's jest setup: "Unexpected token" in `jest/setup.js`); and `testEnvironment` named from jest-expo's preset, because Stryker wraps the environment before Jest applies the preset and falls back to plain node, whose export conditions load the shell from `build/` (the shell-resolution guard test catches it). One project only: Stryker's jest runner flattens `projects` and ran e2e and Vitest files. `disableTypeChecks: false`, or Stryker writes `// @ts-nocheck` into every apps/mobile file during the run (it restores them at the end).

## create-ogs-app (2026-10-18)

- **npm drops `.gitignore` and `.npmrc` from a published package.** A template stores them as `gitignore` / `npmrc` and the CLI renames them (`packages/create-ogs-app/src/plan.ts`); `test/bin.test.ts` packs the package and checks they are in the tarball.
- **`readline/promises` `question()` loses piped lines.** Lines that arrive before a question is asked are emitted as `line` events nobody hears, and at EOF the pending question never settles, so the process exits 0 having done nothing. `createLinePrompt` queues lines and fails a question after the input ends.
- **Template placeholders must not look like JSX.** `{{name}}` collides with `style={{ … }}`; the template uses `__OGS_<NAME>__`, an unknown name throws, and the integration test fails on any leftover.
- **`pnpm create ogs-app` needs the unscoped name `create-ogs-app`.** `pnpm create <x>` runs `create-<x>`; a scoped `@open-game-system/create-ogs-app` would be `pnpm create @open-game-system/ogs-app`.
