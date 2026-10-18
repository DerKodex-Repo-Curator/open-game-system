# Acceptance Tests

Gherkin scenarios defining the behavioral contract of the system.
Testable distillation of product specs in `docs/product-specs/`.

Maintained as `.feature` files, date-named and sorted chronologically.

| Date | Feature File | Covers |
|------|-------------|--------|
| 2026-03-14 | [device-registration.feature](2026-03-14-device-registration.feature) | Device registration + JWT device token issuance (5 scenarios) |
| 2026-03-14 | [send-notification.feature](2026-03-14-send-notification.feature) | Send push via device token, validation, lifecycle (14 scenarios) |
| 2026-03-14 | [cast-device-discovery.feature](2026-03-14-cast-device-discovery.feature) | Cast device detection, availability, scan requests (9 scenarios) |
| 2026-03-14 | [cast-session-lifecycle.feature](2026-03-14-cast-session-lifecycle.feature) | Start/stop casting, interruptions, device switching (10 scenarios) |
| 2026-03-14 | [cast-state-updates.feature](2026-03-14-cast-state-updates.feature) | Game state sync to TV view, error handling (9 scenarios) |
| 2026-03-14 | [cast-receiver.feature](2026-03-14-cast-receiver.feature) | Minimal receiver page, WebRTC connection, display (9 scenarios) |
| 2026-03-14 | [cast-ui-components.feature](2026-03-14-cast-ui-components.feature) | CastButton, DeviceList, CastStatus, React hooks (18 scenarios) |
| 2026-03-15 | [ogs-app-onboarding.feature](2026-03-15-ogs-app-onboarding.feature) | 3-page onboarding flow, notifications permission, skip behavior (12 scenarios) |
| 2026-03-15 | [ogs-app-home-screen.feature](2026-03-15-ogs-app-home-screen.feature) | Continue section, Game Directory, empty state, navigation (13 scenarios) |
| 2026-03-15 | [ogs-app-game-detail.feature](2026-03-15-ogs-app-game-detail.feature) | Game detail screen, features display, launch flow (6 scenarios) |
| 2026-03-15 | [ogs-app-game-screen.feature](2026-03-15-ogs-app-game-screen.feature) | Full-bleed WebView, loading, error, swipe hint, swipe back, push banner (18 scenarios) |
| 2026-03-15 | [ogs-app-continue-lifecycle.feature](2026-03-15-ogs-app-continue-lifecycle.feature) | URL tracking, entry management, swipe-to-close, push routing, persistence, cookie/storage persistence (26 scenarios) |
| 2026-03-15 | [ogs-app-settings.feature](2026-03-15-ogs-app-settings.feature) | Notification toggles, developer mode, debug overlay, custom URLs (18 scenarios) |
| 2026-03-15 | [ogs-app-lifecycle.feature](2026-03-15-ogs-app-lifecycle.feature) | Background/foreground, force quit, memory, offline, deep links (14 scenarios) |

Retired 2026-10-06: `cast-session-api.feature` (v1 `/api/v1/cast/*`) and
`cast-stream-rendering.feature` (one Cloudflare Container per cast), with the code they described
(ADR 2026-10-06-streaming-cloud-run-only). The 2026-03 `cast-session-lifecycle`,
`cast-state-updates` and `cast-to-tv-streaming` files still mention that API in places; the
current cast flow is `cast-first-app`, `cast-receiver-e2e` and `tv-switching`.

## Relationship to Product Specs

Product specs (prose) -> Acceptance tests (Gherkin) -> E2E tests (runnable)

When requirements change:
1. Update the product spec (the intent)
2. Update or create the `.feature` file (the contract)
3. Failing acceptance tests drive the implementation change
| 2026-10-03 | [cast-first-app.feature](2026-10-03-cast-first-app.feature) | Cast-first app: Playing · TV · Library, instances, launcher, games in one stream, swipe back, swap with 0 recasts, Library = your games, a game's page lists its sittings; supersedes the 2026-03-15 home screen |
| 2026-10-04 | [ogs-profiles.feature](2026-10-04-ogs-profiles.feature) | OGS profiles slice 1: make your profile (name, @id, sticker), back up and sign in by email code (app; the API also verifies Apple and Google, emulated), Profile tab, couch sessions owned by the caster, join with the TV code; friends and game tokens listed @later |
| 2026-10-04 | [ogs-friends.feature](2026-10-04-ogs-friends.feature) | OGS friends slice 2: add a friend by QR (accepts at once), code, link or @id (request → accept), requests, remove, presence (online / casting / playing / offline), Join card for a friend's cast, non-friends use the TV code |
| 2026-10-04 | [games-know-you.feature](2026-10-04-games-know-you.feature) | Slice 3: game tokens (ES256, aud = appId, 1 h) with profile id, @id, name, avatar; NameGate skips itself in OGS; TV players in ogs:start; game A's token rejected by game B; never friends/age/device ids; sitting labels per game |
| 2026-10-04 | [launcher-theme.feature](2026-10-04-launcher-theme.feature) | Launcher sound: Home plays the focused game's `art.theme` (quiet, looped), crossfades as the ring moves; silence for no theme, Surprise me, a game's page, Getting ready, a running game, connecting; fade out on start; blocked autoplay retries on the next key |
| 2026-10-04 | [cast-receiver-e2e.feature](2026-10-04-cast-receiver-e2e.feature) | TV receiver: REQUEST_VIEW handshake, LOAD_VIEW on the sender's stream server, URL overrides, default view, error states; laptop PEER_OFFER with HUD, timeout, stop; heartbeat, renderer idle/lifetime 410, no-phone 20 min, 3-hour cap; keeping the TV awake (wake lock, keep-awake clip fallback) (e2e/tests/receiver-*.e2e.ts) |
| 2026-10-04 | [ogs-game-contract.feature](2026-10-04-ogs-game-contract.feature) | The OGS game contract, TV page side: ogs:start on load and after ogs:ready, ogs:suspend/resume (parked = silent, same frame), sitting labels, origin check, plain browser, no cast/join UI on an OGS TV (spec: docs/specification.md) |
| 2026-10-05 | [multi-couch.feature](2026-10-05-multi-couch.feature) | Several households play one game: multiCouch manifest flag, ogs:room → game.room, game.start/ogs:start room, couch claim in game tokens, invites (push + opengame.org/play link), Join with your couch on Playing, Home parks one couch, each couch keeps a Room sitting; Join a friend's cast unchanged (e2e/multi-couch.mjs) |
| 2026-10-05 | [tv-switching.feature](2026-10-05-tv-switching.feature) | Switching TVs works every time: wait for the old Cast session to end before starting the new one, ten alternating switches, the sheet closes at the tap and the hero says "Switching to <TV>…", the couch session renames to the new TV for every phone and the TV's header (tv.rename), one switch at a time with the last TV tapped winning, a clear failure with Try again |
| 2026-10-05 | [observability.feature](2026-10-05-observability.feature) | One wide event per API request, couch action and container step; errors once via console.error with error.type/message; uncaught app errors (global handler, rejections, error boundary) with errorType; no names or tokens; sre-agent at autonomy 0 |
| 2026-10-05 | [cast-logging.feature](2026-10-05-cast-logging.feature) | Client wide events: POST /api/v1/client-events → one JSON line each in Workers Logs; the app's cast lifecycle with an attempt id; offline buffer, flush on background; the receiver logs without credentials; no tokens, hashed device ids; a cast attempt joined phone to TV (phoneAttemptId, sessionId in LOAD_VIEW), the cast prompt's events |
| 2026-10-06 | [stream-full-pipe.feature](2026-10-06-stream-full-pipe.feature) | The cloud stream end to end on one machine: the real renderer (local Chrome + capture extension, no GPU) publishes a local page over WebRTC to the real receiver; moving frames; the renderer's idle stop (`__ogsActivityAt` → `/ping` 410) ends the cast; a warm renderer serves the next cast after a stop; nothing left running; opt-in Cloudflare Realtime + TURN leg (`OGS_E2E_SFU=1`) (e2e/tests/stream-pipe.e2e.ts) |
| 2026-10-06 | [join-and-invite.feature](2026-10-06-join-and-invite.feature) | PLANNED (phones and kids' iPads follow the TV, built 2026-10-06): launcher join QR next to the TV code (opengame.org/join/<code>), web join for guests (name + picture, no install, app is the upgrade), every couch phone and kid's iPad follows the TV (only the host's page picks the TV page), mid-game invite card in the manifest's inviteCorner (phone Invite or ogs:invite), games never draw join codes, "Play on TV with OGS" transfer link; households stay in multi-couch.feature |
| 2026-10-07 | [beta-distribution.feature](2026-10-07-beta-distribution.feature) | Beta distribution: the API's release record per platform (GET public, PUT with RELEASE_TOKEN, never backwards), "Update OGS" for older builds (never blocked by a failed check or a dev build), EAS Update at launch and on resume (not mid-cast), CI ships JS over the air and native changes as TestFlight / Firebase builds |
| 2026-10-07 | [game-push.feature](2026-10-07-game-push.feature) | PLANNED: push handles per player per game; opt in from the app (consent sheet) or the PWA (web push, OGS's VAPID key); one send endpoint with a per-game API key; last-active surface, dead surfaces fall through; never a kid; whenOpen deliver/banner and onOgsNotification; taps open the url; the device-token endpoint is removed |
| 2026-10-07 | [game-links.feature](2026-10-07-game-links.feature) | PLANNED: opengame.org/play opens the app on iOS and Android; first-party game domains open the game's WebView at the exact URL; routing from the catalogue; typed addresses stay in Safari with "Open in OGS"; association files cover the whole site |
| 2026-10-17 | [browser-tv.feature](2026-10-17-browser-tv.feature) | BUILT (not deployed): any TV with a browser pairs with a code and shows the launcher, no Chromecast; the phone casts to it like a Chromecast; direct mode (no cloud stream); stop puts the code back; only the pairing phone casts |
| 2026-10-18 | [invite-another-family.feature](2026-10-18-invite-another-family.feature) | BUILT (not deployed): at session end, a game link with an invite id; funnel events invite_sent → link_opened → testflight_tap → first_session; counts per invite |
| 2026-10-18 | [white-label-apps.feature](2026-10-18-white-label-apps.feature) | BUILT (not deployed): register a game's iOS/Android app (bundle id/package ↔ appId, game API key = owner); upload APNs/FCM credentials (encrypted); the shell registers native tokens per app; a game's push reaches its own app with its own credentials, never another app's; opengame.org link files list every registered app first |
| 2026-10-18 | [white-label-native-sign-in.feature](2026-10-18-white-label-native-sign-in.feature) | BUILT (not deployed): POST /api/v1/auth/native backs a guest up with Apple/Google (audiences: registered apps); the guest is proven by its token; an existing account takes the device |
| 2026-10-18 | [cast-chrome-none.feature](2026-10-18-cast-chrome-none.feature) | BUILT (not deployed): the launcher with chrome=none&app=<appId> shows the game's manifest tvUrl full screen, no launcher chrome, couch still delivered |
| 2026-10-18 | [ogs-cli.feature](2026-10-18-ogs-cli.feature) | BUILT (not deployed): ogs login (the game's API key), apps register, push credentials, doctor |
