# How to run the e2e suites

Every end-to-end suite in the repo, its command and what it needs. Deterministic unless noted
(no model is configured for tester-army `e2e`; no test may start a real GPU stream).

## tester-army `e2e` (`e2e/`, standalone install)

Install once: `cd e2e && pnpm install --ignore-workspace` (its own lockfile; inside the workspace a
plain `pnpm install` installs the root instead). Docs offline: `pnpm exec e2e guide [topic]`.
Run: `cd e2e && pnpm exec e2e run tests/<file>.e2e.ts --target <launcher|ios> --reporter list,markdown`.

| Flow | Test file | Target | Needs |
|------|-----------|--------|-------|
| 1. Receiver, phone path: REQUEST_VIEW until a view, LOAD_VIEW → start-stream/subscribe/answer on the sender's stream server, real frames; URL params override; no default view (it waits for a sender, never streams on its own); failed or unreachable start shows the error and stops the heartbeat | `tests/receiver-view.e2e.ts` | `launcher` | nothing running (all faked in the page) |
| 2. Receiver, laptop path: PEER_OFFER → PEER_ANSWER over Cast, loopback WebRTC frames, HUD iframe for `peer-canvas` (HUD_READY, HUD_MESSAGE), 20 s no-picture timeout → PEER_ERROR, bad offer, PEER_STOP | `tests/receiver-laptop.e2e.ts` | `launcher` | nothing running |
| 3. Receiver stops: heartbeat each minute; renderer idle stop (20 min without `__ogsActivityAt` activity, the renderer's own `isIdle`) via 410; no phone for 20 min; 3-hour cap; activity / a phone returning resets | `tests/receiver-stops.e2e.ts` | `launcher` | nothing running |
| 6. Stream full pipe: the real renderer (`services/api/container/src/server.ts`, local Chrome + capture extension, no GPU) renders a local animated page and publishes its tab over WebRTC to the receiver; the decoded frame count grows and pixels change; the renderer's idle stop (`__ogsActivityAt` → `/ping` via the API's real heartbeat route → 410) ends the cast and closes Chrome; a warm renderer serves the next cast after a stop, 8 relaunches in a row | `tests/stream-pipe.e2e.ts` | `launcher` | the container's deps installed (below); nothing else running. Opt-in `OGS_E2E_SFU=1`: Cloudflare Realtime + TURN instead of the loopback |
| Receiver logs: LOAD_VIEW received (once per distinct view; a repeat is `load_view.ignored` why duplicate), stream started/failed, heartbeat 410, cast ended, `receiver.launched` once, `receiver.sender` connected/disconnected with the count, `streaming` on visibility/keep-awake; after a LOAD_VIEW every event carries its `phoneAttemptId` and `sessionId` → `POST /api/v1/client-events` on its stream server's API, no token, hosts only | `tests/receiver-events.e2e.ts` | `launcher` | nothing running |
| Receiver keeps the TV awake: a screen wake lock once a stream plays (phone or laptop), taken again when dropped or on visible; the keep-awake clip when the API is missing or refuses; both let go on cast end, PEER_STOP, a failed start; `receiver.keepawake` / `receiver.visibility` events. `navigator.wakeLock` and `document.visibilityState` are faked (`openReceiver(browser, { wakeLock: "grant" \| "reject" \| "missing" })`, handle `window.__wakeLock`) | `tests/receiver-awake.e2e.ts` | `launcher` | nothing running |
| TV launcher, live session | `tests/launcher.e2e.ts`, `friends.e2e.ts`, `games-know-you.e2e.ts` | `launcher` | API (`OGS_API`, 8788), launcher (`OGS_LAUNCHER`, 5180), fixture game (`FIXTURE_GAME`, 5190) |
| API over HTTP | `tests/api.e2e.ts` | `launcher` | API (8788) |
| iOS app | `tests/app.e2e.ts`, `friends-app.e2e.ts` | `ios` | Release simulator build with `EXPO_PUBLIC_FAKE_CAST=1`, `EXPO_PUBLIC_OGS_API=http://localhost:8788`; `E2E_IOS_DEVICE` / `E2E_IOS_SESSION` |

The receiver suites (flows 1–3) open `apps/web/public/receiver.html` at a routed origin
(`https://receiver.ogs.test`) with a stub of the CAF receiver SDK (`window.__cast` drives senders),
a mock stream server answered from Node whose SFU is a real `RTCPeerConnection` in a second page,
and a laptop page; every other request is aborted and must stay empty (`rx.blocked`). See
`tests/receiver-kit.ts`.

## Other suites

| Suite | Command | Needs |
|-------|---------|-------|
| TV launcher (Vitest + Playwright), incl. idle (`__ogsActivityAt` on a virtual clock) | `pnpm --filter @open-game-system/tv test:e2e` | builds/serves itself (`apps/tv/e2e/global-setup.ts`) |
| Mobile app (Detox) | `pnpm --filter @open-game-system/mobile e2e` (`e2e:build`, `e2e:test`) | `DETOX_IOS_BINARY`, `DETOX_SIM_NAME`, `E2E_OGS_API`, `FAKE_CAST`, `FAKE_CAST_2`; one stack runs every file: "The whole Detox suite on one stack" below |
| Sign in with an existing account from onboarding lands on that profile: same @id, name and sticker (`profileCardSticker-<id>`), and a relaunch skips onboarding (Detox `e2e/onboarding.test.ts`, "Sign in on a new phone restores the profile"; the code comes from the API's Local Explorer) | `pnpm --filter @open-game-system/mobile e2e:test -- e2e/onboarding.test.ts` | the API the build points at |
| Onboarding Back on every step, notifications undecided: welcome ⇄ notifications ⇄ profile (typed name kept), Skip → profile → Back → notifications; the sign-in sheet's Use another email (code → address) and Not now (→ the welcome) (Detox `e2e/onboarding-back.test.ts`) | `pnpm --filter @open-game-system/mobile e2e:test -- e2e/onboarding-back.test.ts` | the API the build points at |
| The game page's one filled button: Play with nothing to rejoin, Start game beside a sitting (whose Rejoin is outlined); the Library hero's Play over the art. Read from the pixels (`takeScreenshot`, share of lamp #ffc861) (Detox `e2e/start-game-filled.test.ts`) | `pnpm --filter @open-game-system/mobile e2e:test -- e2e/start-game-filled.test.ts` | API, launcher, fake Chromecast(s) (`FAKE_CAST`, `FAKE_CAST_2`) |
| Rejoin pill only on TV, Friends and Profile (not Playing or Library) (Detox `e2e/game-screen.test.ts`, `e2e/continue-lifecycle.test.ts`) | `pnpm --filter @open-game-system/mobile e2e:test -- e2e/game-screen.test.ts` | API, launcher, fake Chromecast |
| Play → cast prompt → Cast (Detox `e2e/play-cta.test.ts`) | `pnpm --filter @open-game-system/mobile e2e:test -- e2e/play-cta.test.ts` | API, launcher, fake Chromecasts (`EXPO_PUBLIC_FAKE_CAST=2`) |
| The TV says "Paused" once: with the paused game's icon focused, its card focused, and on its page (counted on screen: rendered text whose middle isn't covered; the game page is opaque over Home's spotlight) (`apps/tv/e2e/launcher.e2e.ts`); the launcher's theme plays only on Home (`apps/tv/e2e/theme.e2e.ts`) | `pnpm --filter @open-game-system/tv test:e2e` | builds/serves itself |
| One start is one sitting (Story Nook: Play → Cast; the game's page lists one sitting, the API one instance under the couch's id) | `e2e/one-sitting.test.ts` (Detox, in apps/mobile) | the build against a local API with `CATALOGUE_START_URLS={"story-nook":"http://localhost:8821/"}`, Story Nook `pnpm dev` on 8821 (lobby only, no narration), launcher, `node fake-chromecast.mjs --port <p>` (`EXPO_PUBLIC_FAKE_CAST=2`) |
| A stranger household, from nothing to playing: the host installs, makes a profile, picks Bake Shop, Play → Cast → the TV starts it; a guest's fresh install opened by the TV's join link (`https://opengame.org/join/<code>`) onboards and lands on the couch with the remote. Times each step and counts taps (`E2E_SHOTS/funnel.json`); docs/funnel-audit.md (Detox `e2e/first-time-funnel.test.ts`) | `DETOX_SIM_NAME=<yours> E2E_OGS_API=<api> FAKE_CAST=<fake> E2E_SHOTS=<dir> pnpm --filter @open-game-system/mobile e2e:test -- e2e/first-time-funnel.test.ts` | API, launcher, fixture-free (games from the catalogue), fake Chromecast; a build with `EXPO_PUBLIC_FAKE_CAST=1` and `EXPO_PUBLIC_FAKE_CAST_URL` at that fake |
| No Chromecast, a browser TV: the fake Chromecast's browser opens the TV page in screen mode (`?screen=1&api=`), shows a code; Play → No TV found → Use a browser TV → the code → Cast: the game starts on that browser; Stop casting puts the code back (Detox `e2e/browser-tv.test.ts`) | `DETOX_SIM_NAME=<yours> E2E_OGS_API=<api> OGS_TV=<launcher> FAKE_CAST=<fake> pnpm --filter @open-game-system/mobile e2e:test -- e2e/browser-tv.test.ts` | API (schema with `screens`), launcher built from this branch, fake Chromecast; a build with `EXPO_PUBLIC_FAKE_CAST=none` |
| A guest with no app (Playwright, no simulator): the real launcher is the TV; a phone browser decodes the TV's QR, opens `/join/<code>` on this branch's site, joins from the browser (name, sticker), is on the TV's couch, follows the TV into Bake Shop's phone page in room OVEN (the fixture TV page sends `ogs:room`), Home brings it back to the remote, its remote moves the TV's focus; step times in `results.json` | `cd e2e && node first-time-funnel-web.mjs --evidence <dir>` | API (`OGS_API`) with `CATALOGUE_START_URLS={"bake-shop":"<fixture>/"}` and this branch's schema, launcher (`OGS_TV`), site (`OGS_WEB`, built with `VITE_OGS_API`), fixture game (`FIXTURE_GAME`) |
| **The whole stranger funnel on the preview** (opt-in, live preview services, no production): the front door's catalogue tap (reports whether its "Open in OGS" is the game link) → the preview site's `/play/rocket-crew` → the app (Detox, fresh install) opens on Rocket Crew after onboarding → TV tab › Use a browser TV with the code a browser TV page shows → Cast → the guest decodes the TV's QR, joins from the browser, is on the couch → Dana plays Rocket Crew: the TV frames it, the guest follows in as the Fixer → Ready, launch → the Captain's first line is read off the phone and the Fixer presses that control → the TV says fixed. Step timeline and checks in `results.json` | `pnpm exec tsx e2e/stranger-funnel-preview.ts` (repo root) with `DETOX_IOS_BINARY` (a build with `EXPO_PUBLIC_OGS_API=https://opengame-api-pr-funnel.jonathanrmumm.workers.dev`, `EXPO_PUBLIC_OGS_TV=https://funnel.ogs-tv.pages.dev`, `EXPO_PUBLIC_FAKE_CAST=none`), `DETOX_SIM_NAME`, `ROCKET_CREW_DIR` (a rocket-crew checkout, for its line parser) | the preview deploys: API Worker `opengame-api-pr-funnel` (own D1 `opengame-api-pr-funnel-db`), Pages branch `funnel` of `ogs-tv` and `opengame-org`, Worker `rocket-crew-funnel` (trusts the preview JWKS; the preview catalogue points Rocket Crew there). Slow on a loaded machine: steps wait up to 20 min |
| **Invite another family, two households on the preview** (opt-in, live preview services): Dana (Detox) casts to a browser TV, opens Rocket Crew, stops, taps Invite another family; the Lees' phone browser opens the link (`link_opened`), taps Get OGS (`testflight_tap`), then a fresh install opens the page's app link, onboards and casts to their own browser TV (`first_session`). Checks each step on `GET /api/v1/family-invites/:id` | `pnpm exec tsx e2e/invite-family-preview.ts` (repo root) with `DETOX_IOS_BINARY` (the preview build, as above), `DETOX_SIM_NAME` | the preview deploys; the preview site built with `VITE_OGS_GET_APP` |
| **The second visit, next day, on the preview** (opt-in, live preview API): day 1 Dana (Detox) onboards, casts to a browser TV by code, Grandma joins from the QR in a browser, they play Rocket Crew's first round, Dana stops casting and closes the app; day 2 the TV page, Grandma's browser (Playwright clock) and the phone (launch argument `ogsClockOffsetMs`) run a day ahead: same TV code, Cast names the TV (no code), the TV's first card is Play again with the ring on it, Grandma's Join as Grandma, OK, first round played. Counts Dana's taps and times | build `apps/tv` and `apps/web` with `VITE_OGS_API=<preview API>` (and `VITE_OGS_TV` for web), then `pnpm exec tsx e2e/second-visit-preview.ts` (repo root) with `DETOX_IOS_BINARY` (a preview build with `EXPO_PUBLIC_E2E_CLOCK=1`), `DETOX_SIM_NAME`, `ROCKET_CREW_DIR` | the preview API and `rocket-crew-funnel`; the TV page and join page are served locally (vite preview, ports 5320/5321) |
| TV join card: the QR (decoded off a screenshot with jsQR) is `https://opengame.org/join/<code>`, the copy, bottom-right clear of the focus row and couch, on Home and Getting ready (`apps/tv/e2e/join-qr.e2e.ts`) | `pnpm --filter @open-game-system/tv test:e2e` | builds/serves itself |
| Fake Chromecast (for Detox/iOS runs) | `cd e2e && node fake-chromecast.mjs [--port 5181]` | Playwright Chromium |
| Switching TVs: 10 alternating switches, then a change of mind mid-switch (tap Bedroom, reopen "Cast to" while it switches, tap Living room: ends on Living room); after each, the hero says "Switching to <TV>…" then names the TV, and the TV's launcher header (fake Chromecast `/launcher` `roomName`) names it too (Detox `e2e/tv-switch.test.ts`) | `pnpm --filter @open-game-system/mobile e2e:test -- e2e/tv-switch.test.ts` | API, launcher, two fake Chromecasts (5181, 5182); a build with `EXPO_PUBLIC_FAKE_CAST=2`, `EXPO_PUBLIC_FAKE_CAST_URL=http://localhost:5181/load`, `EXPO_PUBLIC_FAKE_CAST_URL_2=http://localhost:5182/load`, `EXPO_PUBLIC_FAKE_CAST_END_MS=3000` (long enough to reopen the sheet mid-switch; the fake's `/stop` closes a recording browser context, which takes seconds too, and the app waits at most 8 s for an end); `FAKE_CAST` / `FAKE_CAST_2` if not on those ports; `E2E_OGS_API` |
| Cast while a session is up, seam (no simulator): same TV connected → no start; connecting → waits; another TV → end, wait, start; a refused start with no session is no-tv, with a session up refused-session-active; one cast at a time. The fake's `refuseWhileActive` (`EXPO_PUBLIC_FAKE_CAST_REFUSE_ACTIVE=1` in a build) refuses a start while a session is up, as Google Cast does | `cd apps/mobile && pnpm exec jest services/__tests__/cast-flow-session.test.ts components/ogs/library/__tests__/cast-prompt-outcomes.test.ts` (part of `pnpm test`) | nothing |
| Switching TVs, seam (no simulator): the cast flow + sync against two fake Chromecasts with Cast's real end timing | `cd apps/mobile && pnpm exec jest services/__tests__/cast-switch.seam.test.ts` (part of `pnpm test`) | nothing |
| Couch flow across devices | `cd e2e && node couch-flow.mjs` | API (8788), launcher (5180), fake Chromecast (5181), fixture game (5190) |
| Several households, one room (multiCouch): three couches, three recorded launchers, Night Flight; the Mumm phone in the simulator under Detox taps Invite; a Smith card moves every TV; Home/Continue on one TV; synced 2×2 video | `cd e2e && node multi-couch.mjs` (`MUMM_PHONE=scripted` without the simulator) | below |
| Every couch phone follows the TV (Rocket Crew, real room): Dad's scripted phone starts it, Mom's phone (iOS app, Detox) joins with the TV code, waits while the TV hasn't named the room, follows into `/join/<R>` (Rocket Crew's room then has Captain Dad + Fixer Mom by OGS id), steps out without parking the TV, follows Home + Continue back into the same seat, Home returns it to the remote; Juneau's iPad (scripted tablet couch client + fake WebView page, no roster) follows into the same room as the Lookout, its page's `game.view` leaves the TV page, Home/Continue/Home move it too; synced phone+TV video | `cd e2e && node phones-follow.mjs` | below |
| 4. API stream routes against a mock renderer, Realtime and TURN (start, publisher answer forwarding, subscribe/answer, heartbeat 410/502, ice-servers fallback, readiness, error contract) | `cd services/api && pnpm exec vitest run test/stream-sfu.test.ts test/stream-routes.test.ts test/stream-ready.test.ts test/stream-ready-check.test.ts` (part of `pnpm test`) | nothing (fetch stubbed) |
| 5. Post-deploy stream readiness | `pnpm --filter @open-game-system/api stream:ready <apiBase>` (below) | network, `gcloud` (optional) |
| API integration (workerd) | `pnpm --filter @open-game-system/api test:integration` | emulators started by its global setup |
| Stream server container | `cd services/api/container && pnpm test` (`tsx --test`) | its deps (see Stream full pipe) |

## Stream full pipe (`e2e/tests/stream-pipe.e2e.ts`)

The real renderer on this machine, no Cloud Run, no GPU (SwiftShader), no Cloudflare by default:

```bash
# once: the renderer's deps at the image's pinned versions (it builds from package-lock.json;
# pnpm import writes an untracked pnpm-lock.yaml: don't commit it), and its Chrome for Testing
cd services/api/container && pnpm import --ignore-workspace && pnpm install --ignore-workspace --frozen-lockfile
pnpm exec puppeteer browsers install chrome
# run (each test ~10-30 s; hard limit 120 s per test)
cd e2e && pnpm exec e2e run tests/stream-pipe.e2e.ts --target launcher --reporter list,markdown
```

- Each test spawns `tsx src/server.ts` on a free port (`STREAM_IDLE_MS=4000`), a local view page
  (a canvas that cycles colour with a moving square, keeping `window.__ogsActivityAt` fresh until the
  test says nobody plays) and the receiver with `tests/receiver-kit.ts`'s stubbed Cast SDK.
- The SFU is a loopback stand-in (`renderer-kit.ts` `loopbackStreamServer`): the renderer's
  `/publisher/prepare` offer is the receiver's subscribe offer and the receiver's answer goes to
  `/publisher/answer`; host candidates only. The heartbeat runs the API's own route
  (`services/api/src/routes/stream.ts`, in process) against the renderer's `/ping`.
- `OGS_E2E_SFU=1` adds the Cloudflare leg: every stream call runs the API's routes with
  `CLOUDFLARE_REALTIME_APP_ID`, `CLOUDFLARE_REALTIME_APP_SECRET`, `CLOUDFLARE_TURN_API_TOKEN` and
  `CLOUDFLARE_TURN_KEY_ID` from the environment (never printed); missing ones skip the test by name.
  Billable (Realtime + TURN minutes), bounded by the 120 s limit.
- Cleanup: in `finally` the renderer gets SIGTERM (its shutdown closes Chrome), then SIGKILL for its
  process group and any Chrome loading this checkout's extension; a 120 s watchdog does the same if
  the test hangs. Each test then asserts no such process is left. Check by hand:
  `ps -axo pid,command | grep services/api/container`.
- The renderer starts Chrome with `--remote-debugging-port=9222` (as on Cloud Run); a local Chrome
  already listening on 127.0.0.1:9222 did not get in the way.

## Post-deploy stream readiness (no render)

`pnpm --filter @open-game-system/api stream:ready <apiBase> [--probe-renderer]`: the stream route
answers with TURN servers, `GET /api/v1/stream/ready` reports a renderer, Realtime and TURN
configured (booleans), and Cloud Run's control plane (`gcloud run services describe stream-gpu`)
says the renderer is Ready. Starts no stream and no instance. `--probe-renderer` also calls the
renderer's `/health` (no Chrome launch, but on a scaled-to-zero GPU service it cold-starts a billed
L4 instance). Hard limit 20 s; prints results only, never values.

## Several households, one room (`e2e/multi-couch.mjs`)

Everything local (no Cloud Run, no GPU, no SFU), on ports of its own so the shared 8788/5180/5181 stay
untouched:

```bash
SP=<scratch dir>
# API (8798): its own D1, Night Flight's start page local
cd services/api && pnpm exec wrangler d1 execute opengame-api-db --local --persist-to $SP/api --file=schema.sql
pnpm exec wrangler dev --port 8798 --persist-to $SP/api \
  --var 'CATALOGUE_START_URLS:{"night-flight":"http://localhost:8797/"}' --var AVATAR_BASE_URL:http://localhost:5280
# Night Flight (8797), verifying game tokens with that API
cd ~/src/night-flight-owls && pnpm exec wrangler dev --port 8797 --persist-to $SP/nf \
  --var OGS_JWKS_URL:http://localhost:8798/.well-known/jwks.json
# Launcher (5280)
pnpm --filter @open-game-system/tv build && (cd apps/tv && pnpm exec vite preview --port 5280 --strictPort)
# The app (Release, simulator) pointed at them; the script is the fake Chromecast on 5281
cd apps/mobile && EXTRA_PACKAGER_ARGS=--reset-cache EXPO_PUBLIC_OGS_API=http://localhost:8798 \
  EXPO_PUBLIC_OGS_TV=http://localhost:5280 EXPO_PUBLIC_FAKE_CAST=1 EXPO_PUBLIC_FAKE_CAST_URL=http://localhost:5281/load \
  xcodebuild -workspace ios/opengameapp.xcworkspace -scheme opengameapp -configuration Release \
  -sdk iphonesimulator -derivedDataPath $SP/dd -quiet
# Run (a simulator of your own)
cd e2e && DETOX_IOS_BINARY=$SP/dd/Build/Products/Release-iphonesimulator/opengameapp.app \
  DETOX_SIM_NAME="OGS Multi-couch e2e" node multi-couch.mjs
```

The script spawns `detox test e2e/multi-couch.test.ts` (apps/mobile) and talks to it over
`/step/<name>` and `/wait/<name>` on 5281; it records the three TV contexts (Playwright `recordVideo`)
and the simulator (`simctl io recordVideo`), and writes `multi-couch-2x2.mp4`, screenshots and
`results.json` to `docs/exec-plans/active/evidence/2026-10-05-multi-couch/`.

## Every couch phone follows the TV (`e2e/phones-follow.mjs`)

Local only, on its own ports (API 8848, Rocket Crew 8847, launcher 5290, step server 5291):

```bash
SP=<scratch dir>
# API (8848): needs services/api/.dev.vars (OGS_JWT_SECRET, OGS_GAME_SIGNING_KEY), else every token is a 500
cd services/api && pnpm exec wrangler d1 execute opengame-api-db --local --persist-to $SP/api --file=schema.sql
pnpm exec wrangler dev --port 8848 --persist-to $SP/api \
  --var 'CATALOGUE_START_URLS:{"rocket-crew":"http://localhost:8847/"}' --var AVATAR_BASE_URL:http://localhost:5290
# Rocket Crew (8847), verifying game tokens with that API (needs its commits 861b22a + 4f0d1a8: ogsRoom, ogs:room)
cd ~/src/rocket-crew && pnpm exec wrangler dev --port 8847 --persist-to $SP/rc \
  --var OGS_JWKS_URL:http://localhost:8848/.well-known/jwks.json
# Launcher (5290)
pnpm --filter @open-game-system/tv build && (cd apps/tv && pnpm exec vite preview --port 5290 --strictPort)
# The app (Release, simulator) pointed at the API; Mom never casts
cd apps/mobile && EXTRA_PACKAGER_ARGS=--reset-cache EXPO_PUBLIC_OGS_API=http://localhost:8848 \
  EXPO_PUBLIC_OGS_TV=http://localhost:5290 EXPO_PUBLIC_FAKE_CAST=1 \
  xcodebuild -workspace ios/opengameapp.xcworkspace -scheme opengameapp -configuration Release \
  -sdk iphonesimulator -derivedDataPath $SP/dd -quiet
# Run (a simulator of your own)
cd e2e && DETOX_IOS_BINARY=$SP/dd/Build/Products/Release-iphonesimulator/opengameapp.app \
  DETOX_SIM_NAME="OGS Phones-follow e2e" node phones-follow.mjs
```

It spawns `detox test e2e/phones-follow.test.ts` (apps/mobile), which reads its WebView's URL with
Detox's `web` API, and writes `results.json`, three TV screenshots and `phones-follow.mp4` (phone + TV)
to `docs/exec-plans/active/evidence/2026-10-06-phones-follow/` (`raw/` is not committed). A worktree
has no `apps/mobile/ios` (prebuild output, gitignored): copy one, including `ios/build/generated`
(the React Native codegen), or `xcodebuild` fails with "Build input file cannot be found".


## The whole Detox suite on one stack

One build and one set of local servers run every file in `apps/mobile/e2e`, the two driver scripts
included (2026-10-07: all pass this way). Ports of your own, so the shared 8788/5180/5181 stay
untouched:

```bash
SP=<scratch dir>
# A fresh worktree: build the workspace packages first (wrangler and vite resolve their dist),
# copy apps/mobile/ios from the main checkout (with ios/build/generated) and services/api/.dev.vars.
pnpm install && pnpm exec turbo run build --filter="./packages/*"
# API (8868): every game's start page local, so game tokens verify against this API
cd services/api && pnpm exec wrangler d1 execute opengame-api-db --local --persist-to $SP/api --file=schema.sql
pnpm exec wrangler dev --port 8868 --persist-to $SP/api --var AVATAR_BASE_URL:http://localhost:5300 \
  --var 'CATALOGUE_START_URLS:{"rocket-crew":"http://localhost:8857/","story-nook":"http://localhost:8871/","night-flight":"http://localhost:8877/"}'
# Games, each verifying tokens with that API. Story Nook and Night Flight without the paid keys
# (Story Nook's wrangler.toml takes ELEVENLABS_API_KEY / FAL_KEY from the environment):
cd ~/src/rocket-crew && pnpm exec wrangler dev --port 8857 --persist-to $SP/rc --var OGS_JWKS_URL:http://localhost:8868/.well-known/jwks.json
cd ~/src/story-nook && env -u ELEVENLABS_API_KEY -u FAL_KEY pnpm exec wrangler dev --port 8871 --persist-to $SP/sn
cd ~/src/night-flight-owls && env -u ELEVENLABS_API_KEY -u FAL_KEY pnpm exec wrangler dev --port 8877 --persist-to $SP/nf --var OGS_JWKS_URL:http://localhost:8868/.well-known/jwks.json
# Launcher (5300) and two fake Chromecasts (5301, 5302)
pnpm --filter @open-game-system/tv build && (cd apps/tv && pnpm exec vite preview --port 5300 --strictPort)
cd e2e && node fake-chromecast.mjs --port 5301 --evidence $SP/ev1   # and --port 5302 --evidence $SP/ev2
# One build for every file
cd apps/mobile && EXTRA_PACKAGER_ARGS=--reset-cache EXPO_PUBLIC_OGS_API=http://localhost:8868 \
  EXPO_PUBLIC_OGS_TV=http://localhost:5300 EXPO_PUBLIC_FAKE_CAST=2 \
  EXPO_PUBLIC_FAKE_CAST_URL=http://localhost:5301/load EXPO_PUBLIC_FAKE_CAST_URL_2=http://localhost:5302/load \
  EXPO_PUBLIC_FAKE_CAST_END_MS=3000 xcodebuild -workspace ios/opengameapp.xcworkspace -scheme opengameapp \
  -configuration Release -sdk iphonesimulator -derivedDataPath $SP/dd -quiet
# Each file (a simulator of your own: xcrun simctl create "OGS <you>" ...)
export DETOX_IOS_BINARY=$SP/dd/Build/Products/Release-iphonesimulator/opengameapp.app DETOX_SIM_NAME="OGS <you>" \
  E2E_OGS_API=http://localhost:8868 FAKE_CAST=http://localhost:5301 FAKE_CAST_2=http://localhost:5302
pnpm exec detox test --configuration ios.sim.release e2e/<file>.test.ts
# The driver scripts reuse the stack (multi-couch is the fake Chromecast itself: stop the one on 5301)
cd e2e && OGS_API=http://localhost:8868 OGS_TV=http://localhost:5300 GAME=http://localhost:8857 PF_OUT=$SP/pf node phones-follow.mjs
cd e2e && OGS_API=http://localhost:8868 OGS_TV=http://localhost:5300 GAME=http://localhost:8877 MC_PORT=5301 MC_OUT=$SP/mc node multi-couch.mjs
```

Tests that need a sitting's id read it from the API with the launcher token of the TV cast last
(`castSittings` in `apps/mobile/e2e/helpers.ts`): Detox on iOS matches ids and text by name only.

## The Detox suites on Android (emulator)

The same Detox tests run on an Android emulator: configuration `android.emu.release` in
`apps/mobile/.detoxrc.js`. The native Detox wiring (the Detox maven repo, the androidTest runner,
cleartext to `10.0.2.2`/`localhost`) comes from `apps/mobile/plugins/with-detox-android.js`, which
`apps/mobile/app.config.js` adds only when `DETOX_ANDROID=1` at prebuild; store and EAS builds and
the native fingerprint never see it.

One-time setup (no sudo):

```bash
brew install --cask android-commandlinetools   # and a JDK 17 (e.g. zulu@17)
export ANDROID_HOME=$HOME/Library/Android/sdk
sdkmanager --sdk_root=$ANDROID_HOME "cmdline-tools;latest" "platform-tools" "emulator" \
  "platforms;android-35" "build-tools;35.0.0" "system-images;android-35;google_apis;arm64-v8a"
$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager create avd -n ogs_pixel_35 \
  -k "system-images;android-35;google_apis;arm64-v8a" -d pixel_7
```

Build the APKs (the app and its test APK; only the `:app` tasks: `assembleAndroidTest` across every
module fails dexing expo-eas-client), then run a suite:

```bash
cd apps/mobile && DETOX_ANDROID=1 CI=1 pnpm exec expo prebuild -p android --clean --no-install
cd android && EXPO_PUBLIC_OGS_API=<api> EXPO_PUBLIC_OGS_TV=<launcher> EXPO_PUBLIC_FAKE_CAST=none \
  ./gradlew :app:assembleRelease :app:assembleAndroidTest -DtestBuildType=release
DETOX_CONFIGURATION=android.emu.release \
  DETOX_ANDROID_APK=$PWD/app/build/outputs/apk/release/app-release.apk \
  DETOX_ANDROID_TEST_APK=$PWD/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk \
  pnpm exec tsx e2e/stranger-funnel-preview.ts   # from the repo root
```

The stranger funnel on the preview passes on the emulator (140 s, 2026-10-18). Android differences the tests allow for: onboarding has no notifications page when Android already
allows them (the tests tap Maybe later only when it shows); the hardware back button leaves a game
the OGS way (`services/hardware-back.ts`). Test-file changes need no rebuild; app changes need the
gradle step, native ones the prebuild too.

For a phone: `eas build -p android --profile preview` (an internal APK, installable from the EAS
link). The `play` profile (the app bundle for Google Play internal testing) is on branch
`claude/android-native-0e55ec` with the `/join/` App Link.
