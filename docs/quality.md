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
| create-ogs-app | A- | 140 unit + 16 integration + 3 bin/tarball | 96.2% (see "Shell hardening") | CRAP max 7. Generated app verified once with `expo config --type introspect` against the real shell plugin. Stryker configured (skips the bin test). |
| stream-kit-types | A | passing | — | Pure types + basic validation |
| stream-kit-web | B | passing | — | Client + RenderStream tested |
| stream-kit-react | B | passing | — | Hooks and components tested |
| stream-kit-server | C | passing | — | Experimental, private. Router tests exist. |
| stream-kit-testing | C | passing | — | Mock client tested, missing publishConfig |
| cast-kit-core | C | has tests | configured | Stryker configured. Sparse test coverage. |
| cast-kit-react | C | has tests | configured | Stryker configured. Sparse test coverage. |
| apps/web | C | 22 e2e (receiver) | — | Marketing site: build only. `public/receiver.html` (the Cast receiver) has 22 deterministic e2e tests (`e2e/tests/receiver-*.e2e.ts`: LOAD_VIEW, PEER_OFFER + HUD, stops) and 3 full-pipe tests against the real local renderer (`e2e/tests/stream-pipe.e2e.ts`: moving frames, idle 410, Chrome relaunch; the Realtime leg opt-in); see docs/testing/e2e.md. |
| shell | A- | 77 Vitest (config plugin) + 378 jest-expo; the moved runtime modules are also tested by apps/mobile's suites through the shims | every module 98–100% (see "Shell hardening") | `pnpm --filter @open-game-system/shell test:mutate` mutates `packages/shell/src` in place and runs apps/mobile's jest suites + `src/__tests__` (see "Shell runtime mutation" below). The fixture app `examples/shell-single-game` checks the plugin's native config through `expo config --type introspect`. |
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
| create-ogs-app | 93.84% | 617 | 48 | Survivors: float edge comparisons and out-of-range loop bounds in png.ts, sort comparators without ties, error/class name strings. |

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

## Shell runtime mutation (2026-10-18)

The modules moved to `packages/shell/src` left apps/mobile's Stryker scope. `packages/shell/stryker.config.mjs`
mutates them **in place** (apps/mobile resolves `@open-game-system/shell/modules/*` to the real src, never
to a sandbox) and runs `jest.mutation.config.js`: apps/mobile's own jest config plus `src/__tests__`,
with the cwd moved to apps/mobile and jest-expo's test environment named explicitly (docs/lessons.md).
Run from packages/shell: `pnpm test:mutate` (everything) or `pnpm test:mutate --mutate src/<module>.ts`.
Each Stryker runner loads apps/mobile's 90 suites: on a loaded machine the cast batch (268 mutants) took
69 min with concurrency 6, so the rest were not run in this pass.

| Module | Score | Killed / timeout | Survived | Notes |
|--------|-------|------------------|----------|-------|
| cast-store.ts | 100% | 37 | 0 | |
| cast-trace.ts | 100% | 9 | 0 | |
| cast-session-device.ts | 100% | 13 | 0 | 2 runtime errors (not scored) |
| cast-view.ts | 98.5% (was 87.9%) | 54 + 11 | 1 | Equivalent: the empty `catch` around `JSON.parse` (a non-JSON string fails the schema either way). New `src/__tests__/cast-view-trace.test.ts` |
| cast-sync.ts | 97.1% (was 81.7%) | 101 | 3 (2 equivalent + 1 killed since) | Equivalent: `.catch(() => null)` → `undefined` (no device either way) and teardown's `generation--` (any change makes in-flight lookups stale). `session.ended` at warn is now killed by `src/__tests__/cast-sync-trace.test.ts` (checked by hand, not rerun) |
| google-cast-backend.ts | 95.2% → 100% (by hand) | 20 | 1 → 0 | `discovery.failed` killed by `src/__tests__/google-cast-backend-trace.test.ts` (checked by hand, not rerun) |
| cast-once.ts | 88.9% | 8 | 1 | Equivalent: `if (running === p)` in `finally` (nothing can replace `running` while `p` is pending) |
| cast-backend.ts | — | — | — | Types only |
| the other moved modules | see "Shell hardening" below | | | |

## Shell hardening (2026-10-19, branch `claude/shell-harden`)

Every module of `packages/shell/src` scored (the cast batch above excepted). Moved modules: in place with
apps/mobile's suites (`stryker.config.mjs`). Modules apps/mobile never imports: in a sandbox with the
shell's own jest (`stryker.shell-tests.config.mjs`, minutes instead of an hour; docs/lessons.md). The
`.tsx` views are scored too (`--mutate src/X.tsx`). Score = killed / (killed + survived + no coverage);
equivalent mutants are marked in place (`Stryker disable next-line …: equivalent, <reason>`) and not
scored. "Before" is the first run of the module on this branch (before any new test). Kills come from
new tests only (`src/__tests__/*-edges.test.ts`, `sheets-render.test.tsx`, `OgsShell-edges.test.tsx`,
`default-deps.test.ts`, `consent-sheet.test.ts`, …): no existing test was edited.

Moved modules (apps/mobile's suites + the shell's):

| Module | Before | After | Equivalent (marked or listed) |
|--------|--------|-------|-------------------------------|
| client-log | 82.6% (27 runtime errors) | 100% (146) | |
| js-errors | 83.9% | 100% (56) | |
| game-url-store | 100% | 100% (12) | |
| hardware-back | 80.0% | 100% (5) | |
| game-loading | 100% | 100% (5) | |
| consent-sheet | 0% (no test) | 100% (18) | |
| notifications | 100% | 100% (76) | |
| game-notifications | 97.8% | 100% (47) | `.catch(() => false)` → `undefined` |
| push-api | 100% | 100% (28) | |
| push-foreground | 100% | 100% (28) | |
| push-registration | 92.3% | 100% (13) | |
| api-request | 87.5% | 100% (34) | |
| http-json (new: the request steps api-request and api-client share) | 96.3% | 100% (27) | `body` for no body (`JSON.stringify(undefined)` is undefined) |
| identity | 87.5% | 100% (10) | `!raw` (`""` throws, `null` parses to null: both null) |
| game-profile | 89.7% | 100% (77) | the refresh timer's clear (a stray refresh finds no app id), `!id`, `generation--`, `open(null)` with nothing open |
| ogs-bridge | 92.0% | 100% (23) | `sittingFor` default `undefined`, the internal event's name |
| fake-cast | 92.7% | 100% (137; 4 runtime errors not scored) | `if (trickle)` (the first timer still publishes the same list) |
| screen-cast | 99.3% | 100% (151) | |

Shell-only modules (sandbox, the shell's suites):

| Module | Before | After | Equivalent |
|--------|--------|-------|------------|
| account-store | 96.0% | 100% (24) | the internal `SIGNING_IN` name |
| api-client | 86.4% | 100% (22) | |
| background-timer | 100% | 100% (18) | |
| cast-launcher-url | 89.4% | 100% of the rest (46 + 1 equivalent) | `?? ""` after `split` (always a first element) |
| cast-picker | 87.7% | 100% (55) | `browserTv?.pairing` |
| cast-stores | 83.9% | 100% (28) | the run-only storage (read once, at start) ×2, `getDevices` (startDiscovery publishes at once) |
| default-deps | 26.5% (no test) | 100% (34) | |
| device | 95.2% | 100% (21) | |
| expo-haptics-player | 100% | 100% (6) | |
| game-stores | 89.7% | 100% (28) | `isKidDevice: () => undefined` |
| guest-profile | 96.0% | 100% (25) | |
| haptics-store | 93.3% | 100% (15) | |
| incoming-links | 84.6% | 100% (52) | |
| native-push | 90.2% | 100% (59) | a rotated token that fails the schema (the throw is swallowed) |
| native-sign-in | 90.4% | 100% (75) | |
| profile-login | 96.3% | 100% (27) | |
| runtime-config | 80.4% | 100% (46 + 1 killed by hand) | Stryker scores `.default("hidden")` → `""` survived: a static mutant (the schema is built at import, and the jest runner keeps the module); `runtime-config-edges.test.ts` fails with it by hand |
| screens-api | 100% | 100% (26) | |
| shell-identity | 88.6% | 100% (29) | `!raw`, `!parsed.success` (the catch answers null), `apiBase === undefined` (stringify drops it) |
| shell-links | 83.6% | 100% (114) | regex groups' `?? ""` ×4, the `@` check (nothing it could match has one), `$` under the `s` flag, `next === ""` (`"/?#".includes("")`) |
| shell-runtime | 76.1% | 100% (82) | the sheet's first `signIn` (subscribe sets it at once) ×2, `{ ask: false }` → `{}` ×2. The unreachable `"none"` login was removed (setIdentity never gets null) |
| sign-in-providers | 100% | 100% (30) | |
| single-cast | 82.1% | 100% (56) | |
| user-agent | 100% | 100% (2) | |
| webview-status | 90.5% | 100% (39) | |
| CastPickerSheet.tsx | 36.3% | 100% (100) | `accessibilityState.disabled` (Pressable sets it from `disabled`) |
| OfflineScreen.tsx | 28.1% | 100% (32) | |
| OgsShell.tsx | 60.6% | 100% of the rest (70 + 1 equivalent) | `[runtime]` effect deps (runtime is useState: never changes) |
| ShellWebView.tsx | 69.2% | 100% (26) | |
| SignInSheet.tsx | 29.0% | 100% (69) | |

The views' layout and colours are pinned by snapshots (`__snapshots__/sheets-render.test.tsx.snap`,
`OgsShell-edges.test.tsx.snap`): a deliberate restyle updates them (`jest -u`). Two `Stryker disable`
comments (cast-launcher-url's `?? ""` inside a call chain, OgsShell's effect deps) don't take: Stryker
attaches them to statements, so those two show as survivors in its report.

create-ogs-app: 93.58% at the start of the branch → 96.0% after `src/edges.test.ts` → 95.83% after the
rebase brought the no-Team-ID work (new team-id.ts, next-steps, eas.json clean-up) → 96.2% with the
three survivors that brings killed by `edges.test.ts` (checked by hand; Stryker's last full run
stopped: at a load of 100–200 one run takes over an hour). The 31 left are equivalent: `options.ts`
`dependsOn: "appId"` / `"gameUrl"` (those defaults exist whenever their source does), the default link
domain's `","` / `"-"` (one host at most; `""` also splits to none), `w[0]?.`, `issues[0]?.` and its
fallback (zod always gives an issue), the `skip` result's shape (no branch reads it), `r.kind ===
"value"` (assigning undefined is no answer either), `raw.trim()` for link domains (replies arrive
trimmed); `plan.ts` the two non-icon asset names (only "icon" changes the drawing) and the sort
comparator ×5 (paths are unique and V8's sort only asks `< 0`); `png.ts` ×8 (loop bounds one past the
end touch nothing, `to >= from` vs `>` (no one-pixel span exists: the ring is checked pixel by pixel),
equality with the float radii never happens); `placeholders.ts` `1 - l` (l is 0.36) and `padStart`'s
"0" (no channel is under 0x10 at that lightness); `generate.ts` the Windows `\\` split, `contents[i]
?? ""` and `to === "eas.json"` (no other template file has that line); `line-prompt.ts` `terminal:
false` (needs a real TTY to differ).

CRAP < 8 for every function (game-rig's measure; shell coverage from apps/mobile's and the shell's jest
together, docs/lessons.md):

| Package | Max before | Max after | What changed |
|---------|-----------|-----------|--------------|
| packages/shell/src | 16 (`client-log` event) | 7 (`OgsShell`, `consent`, `webViewUrlFor`) | client-log's event built by `buildEvent`/`errorFields`; the API request steps in `http-json.ts` (api-request and api-client); native sign-in's `exchange`/`authRequest`; shell-links' scheme parts; CastPickerSheet's `DeviceList`/`BrowserTv`/`BrowserTvPanel`; the picker's `castTo`; webview-status as a table; game-profile's `failed` |
| packages/shell/plugin | 10 (`mergeIos`, `mergeNativeConfig`) | 6 | `mergeInfoPlist`, `mergeAndroid`, `pluginsToApply` |
| packages/create-ogs-app | 7 | 7 | none needed |

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
