# First-time funnel: progress

Branch `claude/first-time-funnel-0e55ec`. Goal: a stranger household gets from zero to playing.
Audit and ranking: [docs/funnel-audit.md](../../../funnel-audit.md).

## Done

- 2026-10-17 `14e3d9a2` TV join card: QR to `opengame.org/join/<code>`, "Scan to join, or type", the
  code, "at opengame.org/join" (apps/tv/src/ui/JoinCode.tsx; ogs-protocol `join.ts`; e2e
  `apps/tv/e2e/join-qr.e2e.ts` decodes the QR off a screenshot).

- 2026-10-18 The invite link: `GET /api/v1/join/:code` (no token; names and stickers only),
  `opengame.org/join` and `/join/<code>` (apps/web `Join.tsx`), AASA `/join/*`; the app opens join
  links (`app/join/[code].tsx`) and holds any link that arrives before a profile until onboarding
  is done (`createLinkHold`, released by the tabs layout). Detox `e2e/first-time-funnel.test.ts`:
  host walk and guest-from-QR both green (before: the guest never reached the couch).
- docs/funnel-audit.md: measured walk and the ranked friction list.
- 2026-10-18 Browser TV (#2): API `/api/v1/screens` (b5fcfe99), TV page screen mode (6a5819ba), app
  browser-TV cast backend combined with Google Cast + "Use a browser TV" in the cast prompt and TV tab.
  Detox `e2e/browser-tv.test.ts` green; first-time-funnel still green; 1076 jest tests.

- 2026-10-18 Guests from the browser (#4): API `POST /api/v1/join/:code/guest`, the join page's
  Join from this browser (form + browser remote that follows the TV), `e2e/first-time-funnel-web.mjs`
  all 6 checks green. No-TV view leads with the browser TV (#10).

- 2026-10-18 Batch verification: Stryker 100% on every new module (protocol, TV, API, app
  screen-cast and link-routing); CRAP < 8 for every new function (docs/quality.md).
- 2026-10-18 Game links (#12): `opengame.org/play/<appId>` with no room opens that game's page in
  the app (after onboarding on a fresh install); invite links on the play screen are held through
  onboarding too; the site offers Open in the OGS app. Third Detox walk green.

- 2026-10-18 Preview stack (not production): API `https://opengame-api-pr-funnel.jonathanrmumm.workers.dev`
  (own D1, fresh secrets), launcher `https://funnel.ogs-tv.pages.dev`, site
  `https://funnel.opengame-org.pages.dev`, Rocket Crew copy `https://rocket-crew-funnel.jonathanrmumm.workers.dev`.
  Sent to ogs-front-door. TestFlight click-path: shared notes `morning.md`.
- 2026-10-18 The preview funnel e2e found: app-scheme links lost at a cold start (fixed, 39f1db3f), the
  guest's Remote button over a game's corner (moved), no join QR mid-game (#13), the front door's
  Open in OGS skipping the TV (#14).

- 2026-10-18 **The whole stranger funnel passes against the preview** (`e2e/stranger-funnel-preview.ts`):
  front door catalogue tap → game link → fresh app, onboarding → Rocket Crew's page → browser TV
  paired → cast → guest scans the QR, joins from the browser → Rocket Crew: guest follows in as the
  Fixer → first problem fixed on the TV, 137 s end to end. Only warning: the front door's Open in OGS
  still uses the old link (#14). Evidence: `evidence/preview-funnel/`. It found #15 (iOS motion
  prompt naming a raw domain).

- 2026-10-18 Bet 1, invite another family (6f279668): the two-household e2e passes on the preview
  (`e2e/invite-family-preview.ts`): invite_sent, link_opened, testflight_tap and first_session all
  counted on Dana's invite. Evidence `evidence/invite-family/`. Merge/deploy order and the TestFlight
  click-path (submit build 7) are in ~/.claude/usage-burn/morning.md under Waiting on you.

## Decisions

- The launcher e2e's old copy assertion ("Join from your phone") follows the owner-approved join
  spec (2026-10-06): the spec changed first, so the test's expectation was out of date.
- `apps/tv/e2e/launcher.e2e.ts` "says Paused once" fails under very high machine load (load avg
  500+ from other sessions) and passes 3/3 when the load drops; not touched.

- The join page's logic lives in ogs-protocol (`join-page.ts`), not apps/web: apps/web is on Vite 5,
  which vitest 4 can't run on, and upgrading it would churn files the ogs-front-door session edits.
- `app-links-config.test.ts` expected exactly `/open`, `/open/*`, `/play/*`; it now also expects
  `/join/*`, which the approved join spec requires (an addition, nothing removed).
- Android's `/join/` intent filter is left for a native build (it would force every tester to update).
- Expo Router did not route the https join link at cold start (only `open()` saw it), so `open()`
  handles https join links and the join screen handles `opengame://join/…`; both hold until a profile.
- Detox walks get 300 s each: under the machine's load spikes the host walk passed 120 s.

- Browser TVs plug in as a second cast backend (`combineCastBackends`), so the cast flow, couch
  session and game start are unchanged; the screen gets only the launcher token and boots the
  launcher against its own API base.
- `getDevices()` must return the same array until something changes: the cast prompt reads it with
  useSyncExternalStore (a new array per read was an infinite render loop, caught by Detox).

## Android (2026-10-18)

- Android SDK + AVD `ogs_pixel_35` (API 35, arm64); Detox `android.emu.release`; how-to in
  docs/testing/e2e.md. The preview stranger funnel runs on the emulator.
- **Found by it: no game in the Android app ever saw the OGS profile.** react-native-webview's
  Android `postMessage` fires on `document`; app-bridge-web listens on `window`. `BridgedWebView`
  now injects a `window` MessageEvent on both platforms (test-first, 3 new tests red → green).
- Android onboarding skips the notifications page; the Detox walks tap Maybe later only if shown.
- Back button leaves a game the OGS way; no iOS-only Local Network hint on Android (c0cdadf7).
- **Kept the funnel branch JavaScript-only**: any Expo config change (even Android-only intent
  filters, or eas.json) changes the iOS fingerprint too, which means a new native build and a
  forced update for every tester. Main's fingerprints equal builds 7 (iOS) and 8 (Android); this
  branch's do too. The `/join/` App Link and the `play` EAS profile moved to the stacked branch
  `claude/android-native-0e55ec`. The Detox plugin is added by `app.config.js` only with
  `DETOX_ANDROID=1`.

## Next

See the ranked list in docs/funnel-audit.md. Next up: #8 Android /join/ (native build), guest game-token flag, guest cleanup, deploy (owner).
