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

Loss figures are estimates (stated assumptions), not measurements.

| # | Friction | Who | Est. loss | Status |
|---|---|---|---|---|
| 1 | **The app can't be installed by a stranger.** Not on the App Store (iTunes lookup for `org.opengame.app`: 0 results, 2026-10-17). `IOS_UPDATE_URL` is `beta.itunes.apple.com/v1/app/6820311485`, the internal-tester form; no TestFlight public link is configured (unverified whether one exists in App Store Connect). Android is Firebase invite-by-email. | Host and guests | ~100% | **Owner action** (below) |
| 2 | **No Chromecast, no game.** 12 of 13 live catalogue games are `tv: "required"` (only Pocket Draft is `optional`); Cast reach is ~10–15% of TVs (ADR 2026-10-06 estimate). "No TV found" offers Settings, Try again, and "Play on this phone" (one game). | Host | ~85% of households | **Fixed (not deployed)**: browser TV. The TV page with no link pairs by code; the cast prompt's No TV found offers "Use a browser TV"; the launcher and game run in that browser (no GPU). Detox `e2e/browser-tv.test.ts` green. A TV whose browser can't run a game's TV page still can't (smart-TV browsers unverified). |
| 3 | **Cast receiver `807AD5E9` may be unpublished.** An unpublished custom receiver only launches on devices registered in the Cast SDK console, so every stranger's Chromecast would fail with "didn't answer". | Chromecast hosts | 100% of them, if unpublished | **Unverified: owner check** (below) |
| 4 | **A guest needs the app**: install (blocked by #1) plus onboarding (5 taps, a name) before joining. Jackbox sets the bar at "no install". | Guests | est. 40–60% of guests | **Fixed (not deployed)**: Join from this browser (name, sticker), on the TV's couch, a browser remote that follows the TV into each game's phone page. Measured: 4 taps after the scan. Games see a browser guest without OGS identity (they ask for a name; the guest game-token flag is still planned) |
| 5 | **The guest's link was lost through onboarding.** A fresh install opened by the TV's link went to onboarding, then to Library; the app didn't know join links at all. | Guests | 100% of QR guests | **Fixed** (`apps/mobile`: join links, held through onboarding; e2e green) |
| 6 | **The TV said "Join from your phone" and a code**, with no address, no QR: a guest doesn't know which app or where to type. | Guests | est. 30–50% of guests | **Fixed** (QR + "at opengame.org/join"; `opengame.org/join/<code>` page) |
| 7 | **Cloud GPU stream on the first cast**: Cloud Run L4 scales to zero with `maxScale 1`. The phone waits 8 s (`CAST_WAIT_MS`) for the launcher; a cold GPU start is likely longer (unmeasured), so the first cast may say "didn't answer". One instance may also cap concurrent households (unverified). | Chromecast hosts | unknown | Unverified; browser TV (#2) avoids the GPU entirely |
| 8 | **Android doesn't claim `opengame.org/join/`** (needs an intent filter, a native build that forces every tester to update). iOS gets it from the AASA file. | Android guests | Android share | Follow-up |
| 9 | **The join page can't link to the app** until #1 exists: it says "It's in beta: ask <host> to send you an invite". `VITE_OGS_GET_APP` turns on a real link. | Guests | (part of #1) | Waits on #1 |
| 10 | "No TV found" leads with Chromecast troubleshooting; "Use a browser TV" sits below it. A household that has no Chromecast reads three wrong causes first. | Hosts without Chromecast | est. 5–10% of them | **Fixed**: "No Chromecast? Any TV with a browser works" and the button come first |
| 12 | **A game link without a room was a dead end** ("That link has no room in it", and the site said "missing its room"): the front door's and games' "Play on your TV" link had nowhere to go. | Hosts from a game's page or the front door | all of them | **Fixed**: `opengame.org/play/<appId>` opens that game's page in the app (after onboarding on a fresh install); the site offers Open in the OGS app. Invite links held through onboarding too (the play screen said "Make your OGS profile first" and stopped). |
| 11 | Onboarding asks about notifications before any value, and for an @id. Measured 5 taps + a name, ~20 s. | Everyone | est. <5% | Leave |

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
3. **Deploy** this branch's API (`GET /api/v1/join/:code`), launcher (QR card) and opengame.org
   (`/join`, AASA `/join/*`) once merged; the app part ships as a JS update.

## What changed on this branch

See progress.md for commits. Seams covered: `GET /api/v1/join/:code` (API route test against D1),
the join link and page logic (ogs-protocol), link routing + the hold (jest), the TV card (Playwright,
QR decoded), the whole walk (Detox).
