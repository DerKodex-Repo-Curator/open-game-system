# Exec plan: `@open-game-system/shell`, `create-ogs-app`, Rocket Crew app

Design (decided): [docs/design-docs/white-label-shell.md](../../design-docs/white-label-shell.md). Branch `claude/shell-app`.
Never merge OGS `main` from this branch (main deploys production); push the branch.

## Facts that shape the extraction (checked 2026-10-18)

- `.npmrc` `shamefully-hoist=true`; jest mocks a node module by its resolved real path, so a `jest.mock("react-native-google-cast")`
  in an apps/mobile test still intercepts the same import from `packages/shell/src` **only if both resolve to the same `.pnpm` folder**.
  The shell declares those modules as peerDependencies plus devDependencies with **exactly** apps/mobile's specifiers. A guard test checks it.
- jest-expo transforms files outside node_modules with `expo/internal/babel-preset`; the RN test env uses export conditions
  `['require','react-native']`; Expo's tsconfig base has `customConditions: ["react-native"]`. An `exports` map with `"react-native"` first
  sends Jest, Metro and tsc to TS source: no build needed to test.
- Don't bundle the shell into one file (app-bridge-react-native style): import-time side effects (`notifications.ts` calls
  `setNotificationHandler`) and native imports would leak into every test. Per-file modules: source via the `react-native` condition,
  per-file `tsc` build to `build/` for publishing.
- Metro inlines `EXPO_PUBLIC_*` only in app code: `services/config.ts` stays in the app. The shell gets config passed in or reads
  `Constants.expoConfig.extra.ogsShell` (written by the plugin).
- `app-links-config.test.ts` reads `apps/mobile/app.json` directly: app.json keeps its associatedDomains and intentFilters; any plugin
  used by apps/mobile is additive and skips duplicates.
- Sign-in today is email-only; `ogs-api.ts` already has `Credential = apple|google {idToken}`; no guest profile; haptics only in
  `components/ogs/remote/press.ts`; `components/GameLoadingOverlay.tsx` is dead code.
- Adding a native module or config plugin to apps/mobile changes its fingerprint (new native build, not OTA). JS-only workspace deps don't.
- `.github/workflows/ci-mobile.yml` triggers on `apps/mobile/**` only: add `packages/shell/**`.

## Extraction approach

`git mv` the implementation to `packages/shell/src/<name>.ts`; leave `apps/mobile/services/<name>.ts` as a one-line shim
`export * from "@open-game-system/shell/modules/<name>";` (no service has a default export). One module instance either way.

Moves (generic shell): cast-session-device, cast-backend, cast-once, cast-trace, client-log, js-errors, game-url-store, hardware-back,
push-registration, push-foreground, game-loading; then (RISK, google-cast mocks) cast-store, cast-view, cast-sync, google-cast-backend,
fake-cast, screen-cast; then (RISK) notifications, consent-sheet; then split ogs-api (generic: OgsApiError, createApiRequest,
ProfileSchema, LoginSchema, Credential, OgsApiOptions → `src/api-request.ts`) and identity (schema + storage → shell; STICKERS stay),
then game-profile, push-api, ogs-bridge, game-notifications.

Stay in apps/mobile: link-routing + deep-links (`link-routing.test` mocks `../deep-links` by relative path), config.ts, cast-flow,
cast-switch, cast-stop, game-cast-route (launcher/couch), sign-in-flow (email), ota/app-release/update-check, user-message,
AppErrorBoundary, UpdateRequired, everything OGS-app-specific (tabs, catalogue, friends, couch, onboarding, library…).

## Package shape

- `packages/shell/package.json`: peers (react-native-google-cast, expo-notifications, expo-device, expo-constants, expo-linking,
  async-storage, react-native, react-native-webview, expo-secure-store, expo-haptics, expo, react; expo-apple-authentication optional);
  exports `"./package.json"`, `"./app.plugin.js"`, `"."` and `"./modules/*"` as `{ "react-native": "./src/…ts", "types": "./src/…ts",
  "default": "./build/…js" }`, `"./plugin"` (pure core). Scripts: build (tsc runtime → build/, tsc plugin → plugin/build), typecheck, test.
- Plugin tests: Vitest (pure). RN tests: jest-expo (like packages/app-bridge-react-native).
- `plugin/src/shell-config.ts` (zod ShellConfigSchema: appId, gameUrl https, name, icon, splash, branding hidden|powered-by default hidden,
  linkDomains default [], cast {receiver:"ogs"}); `plugin/src/native-config.ts` pure `nativeConfigFor(config)`:
  ios.associatedDomains (applinks:<domains> + applinks:opengame.org), ios.usesAppleSignIn, infoPlist NSLocalNetworkUsageDescription
  (with the app name) + NSBonjourServices `_googlecast._tcp`; android autoVerify VIEW intent filters (link domains `/`, opengame.org
  `/play/<appId>`); plugins react-native-google-cast {receiverAppId "807AD5E9", iosStartDiscoveryAfterFirstTapOnCastButton:false},
  expo-notifications, expo-apple-authentication, expo-splash-screen; extra.ogsShell {appId, gameUrl, branding, linkDomains}.
  Never sets bundleIdentifier, package, appleTeamId, owner. `withOgsShell` merges without duplicates, idempotent; sub-plugins
  withShellLinks/Cast/Push/SignIn exported.
- Runtime: `createShellRuntime(config, deps)`, `<OgsShell config? />` (ShellWebView = BridgedWebView with cast/profile/notifications/
  ogs/haptics stores, loading, OfflineScreen, SignInSheet, push prompt), hooks. No expo-router dependency.

## New in the shell (single-game needs)

Straight into gameUrl; guest device profile (`ensureGuestProfile`, contract with the API session); native sign-in
(`native-sign-in.ts` + `SignInSheet.tsx`, expo-apple-authentication; Google behind an interface) against
`POST …/auth/native {provider, identityToken, deviceProfileId?}` with a fake fetch; `shell-links.ts` (opengame.org/play/<appId>/<rest>
→ gameUrl origin + rest; link domains as is; push URLs on the game origin as is); `webview-status.ts` + `OfflineScreen.tsx` (keep
testIDs gameErrorScreen/gameRetryButton); a haptics bridge store (new ogs-protocol schema + docs); cast `chrome: "none"` optional
field (existing payloads unchanged); "Powered by OGS" mark when branding is powered-by.

## Steps (each green and committed)

0. Acceptance feature `docs/acceptance/2026-10-18-white-label-shell.feature` + index; scaffold package; apps/mobile depends on it;
   new guard test `apps/mobile/services/__tests__/shell-resolution.test.ts` (real paths of mocked modules equal from shell src and
   app); CI paths; docs/structure.md, CLAUDE.md source layout; ADR `docs/adrs/2026-10-18-shell-package.md` + index; check the
   apps/mobile fingerprint is unchanged.
1. Plugin pure core (Vitest red → green). 2. withOgsShell + app.plugin.js. 3. Move pure modules. 4. (RISK) cast modules.
5. (RISK) push. 6. (RISK) split ogs-api/identity, move bridge stores. 7. shell-links. 8. webview-status + OfflineScreen + ShellWebView.
9. guest profile. 10. native sign-in. 11. haptics store. 12. cast chrome none. 13. createShellRuntime + OgsShell.
14. `examples/shell-single-game` fixture + `expo config --type introspect` check.
15. (optional, RISK) apps/mobile game.tsx uses ShellWebView/OfflineScreen (Detox).
16. (defer) apps/mobile adopts sub-plugins (new native build).
Then create-ogs-app (template + `pnpm create ogs-app` + REVIEW_NOTES.md + apps/docs "Ship your game as its own app"),
then Rocket Crew `~/src/rocket-crew/app/`.

Rule for every step: never edit an existing test; a step that would break one is reverted and the module stays in the app.

## Progress notes

Steps 0–6 done on `claude/shell-app` (2026-10-18). apps/mobile: 90 suites / 1142 tests green after every step
(baseline 89 / 1114 + the new shell-resolution guard). Shell: 47 Vitest + 2 jest-expo tests.

- **Moved** (shim in apps/mobile/services): cast-once, cast-trace, client-log, js-errors, game-url-store, hardware-back,
  push-registration, push-foreground, game-loading (step 3); cast-session-device, cast-backend, cast-store, cast-view,
  cast-sync, google-cast-backend, fake-cast, screen-cast (step 4; cast-session-device and cast-backend moved here, not in
  step 3, because they import cast-store/cast-sync types); notifications, consent-sheet (step 5); game-profile, push-api,
  ogs-bridge, game-notifications (step 6).
- **Split** (step 6): `ogs-api.ts` → shell `api-request.ts` (OgsApiError, createApiRequest, ProfileSchema, LoginSchema,
  Credential, OgsApiOptions, FetchLike, and `InstanceSource`, which ogs-bridge needs); the app's ogs-api re-exports them.
  `identity.ts` → shell `identity.ts` (schema + secure storage); STICKERS stay in the app file, which re-exports the rest.
- **Kept**: everything the plan lists under "Stay in apps/mobile". No move had to be reverted (no existing test needed an edit).
- **Peer-variant fix** (step 0): the shell's `expo` first resolved to a second `.pnpm` folder; the shell now also pins
  `@expo/dom-webview` and `react-dom` (apps/mobile's specifiers) and its zod is locked to 4.3.6 like the app (docs/lessons.md).
- **Fingerprint**: apps/mobile `a047351a13541a5cf26ae57447dd1026dcb6beeb` before step 0 and after step 6 (`npx @expo/fingerprint .`).
- **Plugin**: `withOgsShell` applies the sub-plugins' Expo plugins through `withPlugins` only when the app neither lists them
  nor has run them (pluginHistory), and is `createRunOncePlugin`'d. `expo-apple-authentication` is not installed in this
  monorepo: an app using the shell must depend on it (create-ogs-app will).
- `mobile-release.yml` also watches `packages/shell/**` (shell code ships to the OGS app over the air).

Step 14 done (2026-10-18): `examples/shell-single-game` (SDK 55, apps/mobile's versions, `expo-apple-authentication`
added there) with `appId: "example-game"`; its Vitest test runs `npx expo config --type introspect --json` and checks
associated domains (+ entitlement), App Link intent filters, `_googlecast._tcp` + `_807AD5E9._googlecast._tcp`,
Sign in with Apple (`usesAppleSignIn` + `com.apple.developer.applesignin`), `extra.ogsShell` and the untouched bundle
id/package. CI: `ci-mobile.yml` (paths include the example). `app/index.tsx` is a placeholder until `<OgsShell />`
lands from `claude/shell-runtime` (TODO in the file).

Shell quality: `packages/shell` has its own Stryker config (in place, apps/mobile's jest suites; docs/quality.md
"Shell runtime mutation", docs/lessons.md). The cast batch ran (cast-store/trace/session-device 100%, cast-view 98.5%,
cast-sync 97.1%, google-cast-backend 100% by hand, cast-once 88.9%, survivors equivalent); the other 17 modules are
not yet measured. New tests: `packages/shell/src/__tests__/{cast-view,cast-sync,google-cast-backend}-trace.test.ts`.

### create-ogs-app ↔ shell integration (2026-10-18, branch `claude/create-ogs-app`)

- Template depends on the shell's new peers `expo-application` and `expo-crypto` (apps/mobile's ranges).
- `<OgsShell />` opens push taps like links (`watchIncomingUrls`: launch link, links while running, the
  launch push via `getLastNotificationResponse`, later taps once per notification id), mapped by `webViewUrlFor`.
- In-app signal: the WebView's user agent gets `OgsShell/<appId>` (`shellUserAgentName`). cast-kit's
  `isOGSCastAvailable()` only sees the bridge (true in the OGS app too), so it can't replace it.
- Guest vs signed in: `login?: "guest" | "apple" | "google"` on `OgsProfileSchema` (`ProfileLoginSchema`),
  filled by the shell's `profileWithLogin`; profile-kit `requestOgsSignIn()` dispatches the account store's `SIGN_IN`.
- Plugin: optional `apiBase` / `tvBase`, written to `extra.ogsShell` only when set (runtime defaults unchanged).
- `app-bridge-react-native` devDependencies pinned to apps/mobile's specifiers (one React / React Native);
  `bridge-resolution.test.ts` guards it. apps/mobile fingerprint `a047351a…` before and after.
- `runtime.stop()` closes the game's profile (`ctx.onStop`); the token refresh timer is unref'd (`backgroundTimeout`).
- Template entry (branch `claude/create-ogs-app-template-entry`, awaiting Jon because it changes an existing
  test): `app/index.tsx` imports `OgsShell` from `@open-game-system/shell/app` (the main entry no longer exports
  it) and passes `expo-apple-authentication`, so Sign in with Apple is offered.

### Device-e2e gaps (Rocket Crew's Maestro run, 2026-10-18, branch `claude/shell-app`)

Acceptance: `docs/acceptance/2026-10-18-shell-device-gaps.feature`.

- **Browser-TV fallback:** the single-game cast store is always available (`createCastStore(commands,
  { alwaysAvailable, showPicker })`; the OGS app passes no options), so the game's `<CastButton>` shows
  with no Chromecast. `SHOW_CAST_PICKER` opens `CastPickerSheet` (runtime `castPicker`): Chromecasts +
  paired browser TVs + "Use a browser TV" (pair by the code `ogs-tv.pages.dev` shows; `createShellScreensApi`
  with the device token; paired TVs in AsyncStorage). A browser TV gets `show { token, app }` for a
  chromeless cast; the API storing `app` and the TV page honouring it are on `claude/screens-chrome-none`
  (off `claude/shell-platform`, where the TV's chrome=none lives). testIDs: ship-your-own-app "Testing on a device".
- **Custom scheme:** `<scheme>://play/<appId>/<rest>`, `<scheme>://play/<rest>`, `<scheme>://<rest>` →
  game origin + `/<rest>`; the plugin's `withShellScheme` sets Expo's `scheme` (config `scheme`, else appId)
  when the app has none; the runtime reads the app's scheme(s).
- **Packaging:** app-bridge-native/-types/-web/-react publish `src` (their `react-native` field);
  app-bridge-react's `react-native`/`source` named `src/index.ts` for `.tsx`. `packages/shell/test/packed-exports.test.ts`
  packs every shell dependency and game kit and checks every package.json target is in the tarball.
- **create-ogs-app smoke (manual, 2026-10-18):** the template lists expo-application and expo-crypto. A fresh
  app from HEAD (`dist/bin.mjs app --app-id smoke-game … --yes`) on tarballs from
  `node packages/shell/scripts/pack-vendor.mjs <app>/vendor` (shell as `file:`, the rest as `pnpm.overrides`)
  installs with `pnpm install --ignore-workspace` and `CI=1 npx expo export --platform ios` bundles
  (1310 modules, 3.9 MB hbc); its `scheme` is `smoke-game`.
- **Launch links (iOS flake, 1 in 4 cold starts opened gameUrl):** a link handed to an app that is already
  starting (Maestro's `stopApp` racing `launchApp`, or a tap during startup) arrives by
  `application:openURL:`, not as a launch option, before any JS "url" listener: React Native's Linking drops
  the event and `getInitialURL` (launch options only) is null. expo-linking keeps it (`getLinkingURL`, set by
  its AppDelegate subscriber / Android activity listener). `<OgsShell />` now defaults to expo-linking, picks
  the WebView's first page from `launchUrl(linking)` (never gameUrl first), and `watchIncomingUrls` reads the
  kept link after subscribing (falls back to `getInitialURL`). Tests: `incoming-links-launch.test.ts`,
  `OgsShell-launch-link.test.tsx`.
- **Identity per API base:** `saveShellIdentity(storage, identity, apiBase)` stores the API base with it;
  `loadShellIdentity(storage, apiBase)` ignores an identity from another API (or with none). The runtime passes
  `config.apiBase` to the guest and native sign-in flows, so production ↔ preview builds never reuse a token
  the other API rejects. Same key `ogs.identity`; apps/mobile uses its own `identity.ts` (unchanged).
  Tests: `shell-identity-api-base.test.ts`.

### Shell hardening (2026-10-19, branch `claude/shell-harden`)

Every `packages/shell/src` module (and the `.tsx` views) mutation-scored: 100% of the non-equivalent
mutants in each, equivalents marked in place; create-ogs-app 96.2%. CRAP < 8 everywhere (shell max 7,
plugin 6, create-ogs-app 7). New tests only. Numbers and the equivalent list: docs/quality.md
"Shell hardening"; run gotchas: docs/lessons.md "Shell mutation and CRAP runs".
