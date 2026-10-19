# 2026-10-18: `@open-game-system/shell` is extracted from apps/mobile, source-first, with one copy of each native module

## Status

Accepted (design: docs/design-docs/white-label-shell.md, decided with Jon 2026-10-18; plan:
docs/exec-plans/active/white-label-shell.md).

## Context

Any OGS game can ship as its own app with the OGS app's native powers (casting, profiles, push, links,
the app bridge). Those powers live in `apps/mobile/services`. A fork would drift; the OGS app has to
become the shell's first consumer, with its 89 test suites untouched. Three facts constrain the shape:

- `jest.mock("react-native-google-cast")` in an app test replaces the module by its resolved **real
  path**. With `shamefully-hoist=true`, the shell's import of the same name only hits the mock when it
  resolves to the same `.pnpm` folder (same version and same peer variant).
- `services/notifications.ts` calls `setNotificationHandler` at import, and several modules import native
  modules at the top. A single bundled entry would run all of that in every test that touches the shell.
- Jest (jest-expo, conditions `require` + `react-native`), Metro and tsc (Expo's `customConditions:
  ["react-native"]`) all honour a `"react-native"` export condition.

## Decision

- A workspace package `packages/shell` (`@open-game-system/shell`), with:
  - **Per-file modules**, exported as `@open-game-system/shell/modules/<name>` and from `.`, each with
    `{ "react-native": "./src/<name>.ts", "types": "./src/<name>.ts", "default": "./build/<name>.js" }`.
    Jest, Metro and tsc read TypeScript source (no build to test); `tsc -p tsconfig.build.json` writes
    `build/` per file for publishing.
  - A **config plugin**: a pure core in `plugin/src` (zod `ShellConfigSchema`, `nativeConfigFor`) tested
    with Vitest, built with tsc to `plugin/build` (CommonJS), loaded by `app.plugin.js`.
  - Runtime tests under jest-expo, like `packages/app-bridge-react-native`.
- Native modules the shell imports are **peerDependencies plus devDependencies with apps/mobile's exact
  specifiers** (plus the devDependencies that pin `expo`'s peer variant: `@expo/dom-webview`,
  `react-dom`). `apps/mobile/services/__tests__/shell-resolution.test.ts` fails when a specifier or a
  real path drifts.
- Moving a module: `git mv` it to `packages/shell/src/<name>.ts` and leave
  `apps/mobile/services/<name>.ts` as `export * from "@open-game-system/shell/modules/<name>";`. One module
  instance either way. A move that would need an existing test edited is reverted; the module stays.
- `services/config.ts` stays in the app (Metro inlines `EXPO_PUBLIC_*` only in app code); the shell gets
  config passed in or reads `Constants.expoConfig.extra.ogsShell`, written by the plugin.

## Consequences

- apps/mobile's native fingerprint does not change (a JS-only workspace dependency); its OTA channel
  ships shell changes, so `mobile-release.yml` and `ci-mobile.yml` watch `packages/shell/**`.
- Adding a native module to the shell means adding it to apps/mobile first (same specifier) or the guard
  test fails; a pnpm install that resolves a new peer variant fails the guard instead of silently
  splitting mocks.
- The shell's TypeScript is compiled by every consumer's toolchain (Metro/Babel, tsc with the
  `react-native` condition). Consumers without that condition use `build/`.
