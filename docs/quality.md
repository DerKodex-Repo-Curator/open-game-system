# Quality Grades

Grade each package/domain. Update after major changes.

| Package | Grade | Tests | Mutation Score | Notes |
|---------|-------|-------|----------------|-------|
| services/api | A- | 58 unit + 57 integration = 115 pass | 68.79% | Full endpoint + D1 integration coverage. CORS, cross-game isolation, content-type all integration-tested. Stryker configured. |
| app-bridge-types | A | n/a | — | Pure types, no runtime code |
| app-bridge-web | A | 15 pass | — | Comprehensive: init, state, subscriptions, errors |
| app-bridge-native | B | passing | — | Core bridge + createStore tested |
| app-bridge-react | B | passing | — | Context/hooks tested |
| app-bridge-react-native | C | passing (Jest) | — | DTS build fails (React 19 vs 18 types mismatch) |
| app-bridge-testing | B | passing | — | Mock bridge tested |
| notification-kit-core | B | 5/5 pass | 66.67% | All tests passing. `_resetBridge` added for test isolation. Stryker configured. |
| notification-kit-react | B | 2/2 pass | — | Previously skipped test now passing. Bridge singleton reset fixed the issue. |
| notification-kit-server | B | 5 pass | 82.35% | Send, bulk, error handling covered. Stryker configured. |
| stream-kit-types | A | passing | — | Pure types + basic validation |
| stream-kit-web | B | passing | — | Client + RenderStream tested |
| stream-kit-react | B | passing | — | Hooks and components tested |
| stream-kit-server | C | passing | — | Experimental, private. Router tests exist. |
| stream-kit-testing | C | passing | — | Mock client tested, missing publishConfig |
| cast-kit-core | C | has tests | configured | Stryker configured. Sparse test coverage. |
| cast-kit-react | C | has tests | configured | Stryker configured. Sparse test coverage. |
| apps/web | C | 22 e2e (receiver) | — | Marketing site: build only. `public/receiver.html` (the Cast receiver) has 22 deterministic e2e tests (`e2e/tests/receiver-*.e2e.ts`: LOAD_VIEW, PEER_OFFER + HUD, stops) and 3 full-pipe tests against the real local renderer (`e2e/tests/stream-pipe.e2e.ts`: moving frames, idle 410, Chrome relaunch; the Realtime leg opt-in); see docs/testing/e2e.md. |
| apps/mobile | B | passing (Jest) + Detox | configured | Services tested, Stryker configured. Detox: 16 files in `apps/mobile/e2e` (incl. the `multi-couch.mjs` / `phones-follow.mjs` driver files), all passing on one local stack 2026-10-07 (docs/testing/e2e.md, "The whole Detox suite"). |

## Grading Scale

- **A** — Well tested, clean architecture, documented
- **B** — Adequate tests, minor debt, mostly documented
- **C** — Gaps in coverage, some debt, docs may be stale
- **D** — Significant gaps, needs attention
- **F** — Untested, undocumented, high risk

## Mutation Testing Summary (2026-03-17)

| Package | Score | Killed | Survived | Notes |
|---------|-------|--------|----------|-------|
| services/api | 68.79% | 302 | 137 | Auth improved to 79%. |
| notification-kit-core | 66.67% | 18 | 9 | Survivors are bridge safety patterns (optional chaining). |
| notification-kit-server | 82.35% | 28 | 6 | Survivors are error message strings. |

## Game push (2026-10-08)

Stryker on the new modules only (`--mutate` list), `coverageAnalysis: off` (per-test coverage
misattributes the D1-proxy route tests and reports false survivors):

| Scope | Score | Killed / timeout | Survived | Notes |
|-------|-------|------------------|----------|-------|
| services/api push (api-keys, base64url, push-delivery, push-handles, game-key-auth, push, push-settings, devices) | 99.5% | 216 | 1 | Equivalent: `c.req.param("appId") ?? ""` (the route always has the param) |
| packages/ogs-protocol push.ts | 100% | 56 | 0 | |
| packages/profile-kit notifications.ts | 100% | 99 | 0 | |
| apps/mobile push services (push-foreground, game-notifications, push-api, link-routing, game-notification-settings) | 100% | 164 | 0 | perTest coverage (jest) was fine here |
| services/api web push (vapid-keys, web-push-sender, push-senders) | 92% (vapid-keys 86%) | 87 | 7 | Equivalent: 6 Web Crypto type guards that can't be reached (`"privateKey" in pair`, `jwk instanceof ArrayBuffer`, `?? ""`) and the AES key's `extractable` flag |
| packages/notification-kit-web (subscribe, sw-core) | 98% (subscribe 100%, sw-core 95%) | 145 | 3 | Equivalent: a timeout answering `undefined` instead of `false`, and `raw ?? ""` / an empty catch around `JSON.parse` |
| packages/notification-kit-server | 96% | 25 | 1 | Equivalent: `readJson` answering `undefined` instead of `null` |

CRAP: every function in the new modules is under 8 (API max 7, app max 6, notification-kit-web max 6, profile-kit max 4, notification-kit-server max 3). The sw.js listeners have no unit coverage; they are one-line wrappers over tested functions and run in the Chromium e2e (`packages/notification-kit-web/e2e/sw.e2e.ts`).

## First-time funnel (2026-10-18)

New code on `claude/first-time-funnel-0e55ec` (join link and page, browser TVs, browser guests).
Stryker with `--mutate` on the new files; CRAP from `scripts/crap.mjs` after coverage.

| Scope | Mutation | Max CRAP |
|-------|----------|----------|
| ogs-protocol `join.ts`, `join-page.ts`, `guest.ts`, `screens.ts` | 100% | 7 (`joinAsGuest`) |
| apps/tv `screen/pairing.ts`, `ui/qr.ts` | 100% | 7 (`screenParams`) |
| services/api `routes/join.ts`, `routes/screens.ts`, `lib/screens.ts` | 100% | 5 |
| apps/mobile `services/screen-cast.ts`, `services/link-routing.ts` | 99–100% (see progress.md) | 7 (`routeLink`, `openLink`) |
| Invite another family: ogs-protocol `family-invite.ts`; API `routes/family-invites.ts`; app `invite-attribution.ts`, `invite-family.ts`, `link-routing.ts` | 100% (the API's mostly by timeout) | 7 (`POST /family-invites/:id/events`; its 429 branch is untested) |

Equivalent mutants are marked in place (`Stryker disable next-line … : equivalent, …`). Not unit
tested: the React views (`ScreenApp.tsx`, `BrowserTv.tsx`, `pages/Join.tsx`, `pages/join/*`); the
Detox walks (`first-time-funnel.test.ts`, `browser-tv.test.ts`) and `e2e/first-time-funnel-web.mjs`
drive them.

## CRAP (2026-10-04)

Target: CRAP < 8 for every function. Measure from a package dir after `pnpm test:coverage`:
`node ../../scripts/crap.mjs --src src --threshold 8` (mobile: `--src services`; the script reads
`coverage/lcov.info`, and `--coverage` can be repeated to merge runs).

| Scope | Max CRAP | Not yet under 8 |
|-------|----------|-----------------|
| packages/ogs-protocol (excl. friends) | 6 | none |
| apps/mobile/services (excl. runtime, app-state, playing-home, friends, ogs-api, identity) | 7 | none |
| apps/tv/src (excl. ui/*.tsx) | 6 | ui components untested in Node (Player, App, GamePage, Home, useFrames) |
| services/api/src (excl. friends, presence) | 44.7 | `POST /sessions/:sid/join` (friends), CouchSession DO methods (need a DurableObjectState; the workerd integration suite covers them but can't be measured) |
