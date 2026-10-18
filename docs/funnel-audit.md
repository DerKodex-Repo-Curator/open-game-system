# First-time funnel audit: can a stranger household get from zero to playing?

2026-10-17/18, branch `claude/first-time-funnel-0e55ec`. A stranger household: not the owner's
family, no OGS app, no account, a TV, phones, maybe a Chromecast. Progress and decisions:
[exec-plans/active/2026-10-17-first-time-funnel/progress.md](exec-plans/active/2026-10-17-first-time-funnel/progress.md).

## How this was walked

- **Production probes** (read-only, 2026-10-17): App Store lookup for `org.opengame.app`, the live
  catalogue, `opengame.org/join/<code>`, the AASA file, GitHub repo variables.
- **The real app** (Release simulator build, fresh install each time) against a local API, the real
  launcher and a fake Chromecast, driven by Detox: `apps/mobile/e2e/first-time-funnel.test.ts`. It
  times each step and counts taps; the same test is now the funnel's e2e coverage.
- **The web join page** in the browser pane at phone size; the **TV** in Playwright
  (`apps/tv/e2e/join-qr.e2e.ts` decodes the QR off a screenshot).

Not walked: a real Chromecast, the cloud GPU stream, TestFlight install (needs the owner's devices
and logins). Those rows say "unverified".

## Measured (simulator, fake Chromecast, local API)

Evidence: `exec-plans/active/2026-10-17-first-time-funnel/evidence/` (`funnel-before.json`,
`funnel-after.json`, screenshots). Times include Detox's own waits; read them as upper bounds.

| Step | Taps | Typed fields | Time | Before the fixes |
|---|---|---|---|---|
| Host: launch → welcome | 0 | 0 | 13–22 s (first launch, cold) | same |
| Host: onboarding (Make my profile, Maybe later, name, sticker, Next, Let's go) | 5 | 1 | 20–24 s | same |
| Host: pick a game, Play → cast prompt | 2 | 0 | 4–5 s | same |
| Host: Cast → game starts on the TV | 1 | 0 | 2–6 s (fake Chromecast; no GPU) | same |
| Guest: scan TV QR → app opens (installed) | 0 | 0 | 10–29 s | **no QR on the TV**; the link had no handler |
| Guest: onboarding → on the couch, remote showing | 5 | 1 | 26–36 s | **never reached the couch**: landed on Library |

Host total: **8 taps, 1 field, ~35 s of interaction** after the app is installed. That part is fine.
The losses are before and around it.

## Friction, ranked by how many new households it loses

Loss figures are estimates (stated assumptions), not measurements. Status as of 2026-10-18:
"fixed" means committed on this branch and covered by tests; nothing here is deployed.

| # | Friction | Who | Est. loss | Status |
|---|---|---|---|---|
| 1 | **The app can't be installed by a stranger.** Not on the App Store (iTunes lookup for `org.opengame.app`: 0 results, 2026-10-17). `IOS_UPDATE_URL` is `beta.itunes.apple.com/v1/app/6820311485`, the internal-tester form; no TestFlight public link is recorded anywhere (whether one exists in App Store Connect is unverified). Android is Firebase invite-by-email. | Hosts | ~100% of hosts | **Owner action** (below). Guests no longer need the app (#4). |
| 2 | **No Chromecast, no game.** 12 of 13 live catalogue games are `tv: "required"`; Cast reaches ~10–15% of TVs (ADR 2026-10-06 estimate). "No TV found" offered only Settings and Try again. | Hosts | ~85% of households | **Fixed**: browser TV. A bare TV page pairs by code; "No TV found" leads with "No Chromecast? Any TV with a browser works"; the launcher and game run in that browser (no GPU). Detox `browser-tv.test.ts`. A smart-TV browser that can't run a game's TV page still can't (unverified per TV). |
| 3 | **Cast receiver `807AD5E9` may be unpublished.** An unpublished custom receiver only launches on registered devices, so every stranger's Chromecast would fail with "didn't answer". | Chromecast hosts | 100% of them, if unpublished | **Unverified: owner check** (below). The browser TV works either way. |
| 4 | **A guest needed the app**: an install (blocked by #1) plus onboarding before joining. Jackbox sets the bar at "no install". | Guests | est. 40–60% of guests | **Fixed**: Join from this browser (name, sticker; 4 taps after the scan), on the TV's couch, a browser remote that follows the TV into each game's phone page. `e2e/first-time-funnel-web.mjs` 6/6. Games see a browser guest without OGS identity (they ask for a name); the guest game-token flag is still planned. |
| 5 | **The guest's link was lost through onboarding**: a fresh install opened by the TV's link went to onboarding, then Library; the app didn't know join links. | Guests with the app | 100% of them | **Fixed**: join links, held through onboarding. Detox `first-time-funnel.test.ts`. |
| 6 | **The TV said "Join from your phone" and a code**, no address, no QR. | Guests | est. 30–50% of guests | **Fixed**: QR to `opengame.org/join/<code>` + "Scan to join, or type … at opengame.org/join" (`apps/tv/e2e/join-qr.e2e.ts` decodes it). |
| 7 | **A game link without a room was a dead end** ("That link has no room in it"; the site said "missing its room"), and invite links stopped at "Make your OGS profile first" on a fresh install. | Hosts arriving from a game or the front door | all of them | **Fixed**: `opengame.org/play/<appId>` opens that game's page (after onboarding); invite links are held through onboarding too. Detox (3rd walk). |
| 8 | **Cloud GPU stream on the first cast**: Cloud Run L4 scales to zero with `maxScale 1`; the phone waits 8 s (`CAST_WAIT_MS`) for the launcher, and a cold GPU start is likely longer (unmeasured), so a first cast may say "didn't answer". One instance may also cap concurrent households (unverified). | Chromecast hosts | unknown | Unverified. Browser TVs (#2) skip the GPU. |
| 9 | "No TV found" led with Chromecast troubleshooting. | Hosts without Chromecast | est. 5–10% of them | **Fixed** (with #2). |
| 10 | **Android doesn't claim `opengame.org/join/`**, and Android's back button left a game without going Home (the TV stayed on it). iOS reads the AASA file. | Android guests with the app | Android share | **Back and the hint fixed (not deployed)**: back leaves the game the OGS way, no iOS-only "Local Network" hint. **`/join/` waits for a native build**: the intent filter (autoVerify, the same `assetlinks.json`) is on branch `claude/android-native-0e55ec`, because any Expo config change is a new native build and a forced update on iOS too. The stranger funnel e2e runs on an Android emulator (docs/testing/e2e.md). Google Play's signing key must be added to `assetlinks.json` once Play signs the app (morning.md) |
| 11 | **The join page can't link to the app** until #1: it says "The OGS app is in beta: ask <host> for an invite". `VITE_OGS_GET_APP` turns on a real link. | Guests who want the app | small (browser join works) | Waits on #1. |
| 13 | **The join QR is gone once a game is on.** It shows on Home and Getting ready only; a guest who arrives mid-game has no code to scan (the host's phone doesn't show it either). | Late guests | est. 30–50% of them | Planned (spec: mid-game invite card in the game's `inviteCorner`); not built |
| 14 | **The front door's "Open in OGS" opens the game's own page** (`opengame.org/open?url=<startUrl>`) in the app, skipping the TV: the host lands in a phone page with nothing on the TV. | Hosts from the front door | most of them | Front-door session: point `OPEN_IN_APP` at `opengame.org/play/<appId>` (sent 2026-10-18); the preview funnel e2e warns until it does |
| 15 | **iOS asks "rocket-crew…workers.dev Would Like to Access Motion and Orientation"** inside the app when a game asks for motion (Rocket Crew's Ready). A raw domain in a system prompt looks like a scam to a stranger. | Players of motion games in the app | est. 5–15% of them | Follow-up (native): the app could grant motion to catalogue games itself (WKUIDelegate's device-motion permission), which needs a WebView change and a native build |
| 16 | **`opengame.org/open?url=<game page>` was a 404 without the app** (bug bash bb-001 from ogs-front-door): the front door's Open in OGS uses it today. | Strangers from the front door | all without the app | **Fixed (preview)**: the site offers Open in the OGS app (`opengame://open?url=…`) and Play in this browser; https pages only |
| 17 | **Nothing turned a good night into a new household**: no way to invite another family, and no way to see whether invites work. | Growth | n/a | **Fixed (not deployed)**: "Invite another family" after Stop casting; the funnel `invite_sent → link_opened → testflight_tap → first_session` as wide events and counts per invite. Two-household e2e green on the preview |
| 18 | **On Android no game saw the OGS profile** (or the cast or session): react-native-webview posts bridge messages on `document`, the game listens on `window`. Rocket Crew asked "Who's playing here?" and never made a room; the TV said "Rocket Crew didn't open". | Every Android household with the app | all of them | **Fixed (not deployed)**: `BridgedWebView` fires each message on `window` (JavaScript only, reaches installs through EAS Update); found by the Android stranger funnel e2e |
| 12 | Onboarding asks about notifications before any value, and for an @id. Measured 5 taps + a name, ~20 s. | Everyone with the app | est. <5% | Leave. |

## The funnel now (measured, local, fake Chromecast)

| Path | Taps | Fields |
|---|---|---|
| Host with a Chromecast: install → profile → game → Play → Cast | 8 | 1 (name) |
| Host with no Chromecast: … → Play → Use a browser TV → code → Cast | 10 | 2 (name, code), plus opening ogs-tv.pages.dev on the TV |
| Guest with no app: scan → Join from this browser → name, sticker → Join | 4 | 1 |
| Guest with the app, first time: scan → onboarding → on the couch | 5 | 1 |

## Owner actions (only Jon can do these)

1. **TestFlight public link** (fixes #1 for iPhone/iPad): App Store Connect → OGS → TestFlight →
   External Testing → add a group → submit a build for Beta App Review → enable **Public Link**.
   Then set it where strangers see it:
   ```bash
   gh variable set IOS_UPDATE_URL --body "https://testflight.apple.com/join/<code>"
   ```
   and build the site with `VITE_OGS_GET_APP=https://testflight.apple.com/join/<code>` (the join
   page's "Get it here").
2. **Cast receiver**: Google Cast SDK Developer Console → application `807AD5E9` → if it says
   "Unpublished", **Publish** (needs the receiver URL `https://opengame.org/receiver` to be final).
3. **Merge and deploy** (after review). Order matters: the D1 schema first (new tables `screens`,
   `guest_profiles`; `CREATE TABLE IF NOT EXISTS`, safe to rerun), then the API, the launcher
   (ogs-tv.pages.dev: QR card, browser-TV pairing), then opengame.org (`/join`, `/play/<appId>`,
   AASA `/join/*`; diff apps/web against the live deployment first, docs/lessons.md). The app
   changes are JavaScript only (the native fingerprints equal builds 7 and 8, checked
   2026-10-18): CI's EAS Update ships them, no new build or forced update. Android's `/join/` App
   Link and the Google Play profile change the native config of both platforms, so they wait on
   branch `claude/android-native-0e55ec` for the next native build.
   ```bash
   pnpm --filter @open-game-system/api db:migrate --remote
   ```

## What changed on this branch

Commits and decisions: progress.md. Tests at each seam: the API routes against a real local D1
(`join-routes`, `screen-routes`), the shared rules in ogs-protocol (join link and page, guest,
screens), the TV's pairing and QR (Vitest; Playwright decodes the QR), the app's link routing,
hold and browser-TV cast backend (Jest), and three end-to-end walks: Detox
`first-time-funnel.test.ts` (host; guest via the app; a game link), Detox `browser-tv.test.ts`
(no Chromecast), and Playwright `e2e/first-time-funnel-web.mjs` (a guest with no app). Mutation
100% and CRAP < 8 on the new modules (docs/quality.md).
