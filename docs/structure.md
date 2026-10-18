# Monorepo Structure

## Workspace Packages

### SDK Packages (`packages/`)

| Path | npm Name | Purpose | Internal Dependencies |
|------|----------|---------|----------------------|
| `packages/app-bridge-types` | `@open-game-system/app-bridge-types` | Core type definitions for the app-bridge protocol | None |
| `packages/app-bridge-web` | `@open-game-system/app-bridge-web` | Web-side bridge client (runs in WebView) | `app-bridge-types` |
| `packages/app-bridge-react` | `@open-game-system/app-bridge-react` | React hooks for web games using app-bridge | `app-bridge-types`, `app-bridge-web` |
| `packages/app-bridge-native` | `@open-game-system/app-bridge-native` | Native-side bridge host (runs in React Native) | `app-bridge-types` |
| `packages/app-bridge-react-native` | `@open-game-system/app-bridge-react-native` | React Native components wrapping the native bridge | `app-bridge-types`, `app-bridge-native` |
| `packages/app-bridge-testing` | `@open-game-system/app-bridge-testing` | Test utilities and mocks for app-bridge | `app-bridge-types` |
| `packages/notification-kit-core` | `@open-game-system/notification-kit-core` | Shared notification types and logic | None (external `app-bridge` dep) |
| `packages/notification-kit-react` | `@open-game-system/notification-kit-react` | React hooks for receiving notifications in-game | `notification-kit-core` |
| `packages/notification-kit-server` | `@open-game-system/notification-kit-server` | `createOgsNotifier`: a game server sends pushes to push handles (spec §9) | `ogs-protocol` (bundled) |
| `packages/notification-kit-web` | `@open-game-system/notification-kit-web` | `subscribeOgsPush` for a game's PWA and OGS's `sw.js` (spec §9) | `ogs-protocol` (bundled) |
| `packages/stream-kit-types` | `@open-game-system/stream-kit-types` | Core type definitions for streaming protocol | None |
| `packages/stream-kit-web` | `@open-game-system/stream-kit-web` | Client-side WebRTC/PeerJS streaming | `stream-kit-types` |
| `packages/stream-kit-react` | `@open-game-system/stream-kit-react` | React hooks for stream lifecycle | `stream-kit-types`, `stream-kit-web` |
| `packages/stream-kit-server` | `@open-game-system/stream-kit-server` | Headless browser renderer (Puppeteer + PeerJS) | `stream-kit-types` |
| `packages/stream-kit-testing` | `@open-game-system/stream-kit-testing` | Test utilities for stream-kit | `stream-kit-types`, `stream-kit-web` |
| `packages/cast-kit-core` | `@open-game-system/cast-kit-core` | Cast store types, Zod schemas, app-bridge helpers | `app-bridge-web` |
| `packages/cast-kit-react` | `@open-game-system/cast-kit-react` | React hooks for cast state and dispatch | `app-bridge-react`, `cast-kit-core` |
| `packages/ogs-protocol` | `@open-game-system/ogs-protocol` | The OGS app v3 contract: game manifest, identity claims, instances + `playingView`, couch-session reducer, launcher↔game frame messages (zod) | None |
| `packages/profile-kit` | `@open-game-system/profile-kit` | Games know who you are: `useOgsProfile()` (the `profile` bridge store in the app WebView), `useOgsSession()` (players + game token from the launcher's `ogs:start`), `reportOgsSitting()`, server `verifyOgsToken()` (ES256 against `/.well-known/jwks.json`). Bundles ogs-protocol + app-bridge-web into its dist; games install its packed tarball from `vendor/` like cast-kit | `ogs-protocol`, `app-bridge-web` (bundled) |
| `packages/shell` | `@open-game-system/shell` | The OGS native shell: an Expo config plugin (`app.plugin.js`, pure core in `plugin/src`, Vitest) and per-file React Native modules extracted from apps/mobile (`@open-game-system/shell/modules/<name>`, TypeScript source through the `react-native` export condition, jest-expo). A game ships as its own app on it; apps/mobile is its first consumer (ADR 2026-10-18) | `app-bridge-native`, `app-bridge-types`, `ogs-protocol` |
| `packages/create-ogs-app` | `create-ogs-app` (unscoped, so `pnpm create ogs-app` finds it) | CLI + Expo template: a game ships as its own App Store / Play app with the `@open-game-system/shell` plugin. `template/` is copied with `__OGS_<NAME>__` placeholders filled; icons are drawn in code; `template/examples` is type-checked against cast-kit-react, profile-kit and notification-kit-server | None at run time (examples type-check against `cast-kit-react`, `profile-kit`, `notification-kit-server`) |

### Services (`services/`)

| Path | npm Name | Purpose | Internal Dependencies |
|------|----------|---------|----------------------|
| `services/api` | `opengame-api` | OGS API: push notifications, households + device tokens, catalogue, library, instances, `CouchSession` DO over WebSocket (Cloudflare Worker + D1 + DO) | `ogs-protocol` |

### Apps (`apps/`)

| Path | npm Name | Purpose | Internal Dependencies |
|------|----------|---------|----------------------|
| `apps/mobile` | `@open-game-system/mobile` | Host app (Expo/React Native), WebView + bridge | `app-bridge-native`, `app-bridge-react-native`, `app-bridge-types`, `app-bridge-testing`, `ogs-protocol`, `shell` |
| `apps/web` | `@open-game-system/web` | opengame.org marketing website (Vite + React + Tailwind) | None |
| `apps/tv` | `@open-game-system/tv` | OGS TV launcher: the one page the Chromecast stream shows for the whole cast; frames each game's TV page (Vite + React, Vitest + Playwright) | `ogs-protocol` |
| `apps/docs` | `@open-game-system/docs` | Docs site for game developers and their coding agents (ogs-docs.pages.dev): `content/*.md` + `docs/specification.md` rendered to static HTML with `.md` twins, `llms.txt`, `llms-full.txt`; protocol tables generated from the zod schemas; tests fail when profile-kit's exports drift from the reference | `ogs-protocol` |

### Examples (`examples/`)

| Path | npm Name | Purpose | Internal Dependencies |
|------|----------|---------|----------------------|
| `examples/expo-bridge-demo` | `@open-game-system/app-bridge-example-expo` | Expo demo of app-bridge | `app-bridge-native`, `app-bridge-react-native`, `app-bridge-types` |
| `examples/web-game-demo` | `@open-game-system/app-bridge-example-react` | React web game using app-bridge | `app-bridge-web`, `app-bridge-react`, `app-bridge-types` |
| `examples/shell-single-game` | `@open-game-system/example-shell-single-game` | Fixture: one game as its own Expo app on the shell's config plugin (appId `example-game`). Its Vitest test runs `expo config --type introspect` (no prebuild) and checks links, Chromecast discovery, Sign in with Apple, `extra.ogsShell` and the untouched bundle id; CI: `ci-mobile.yml` | `shell` |
| `examples/stream-react-demo` | `stream-kit-basic-react-demo` | React demo of stream-kit client | `stream-kit-react`, `stream-kit-types`, `stream-kit-web` |

## Internal Dependency Resolution

All internal dependencies use the `workspace:*` protocol in `package.json`:

```json
{
  "dependencies": {
    "@open-game-system/app-bridge-types": "workspace:*"
  }
}
```

pnpm resolves `workspace:*` to the local package at install time. When publishing, pnpm replaces it with the actual version number.

## Build Order

Turbo manages the build graph via `dependsOn: ["^build"]` in `turbo.json`. The effective build order (leaves first):

```
Layer 0 (no internal deps):
  app-bridge-types, stream-kit-types, notification-kit-core, opengame-api

Layer 1:
  app-bridge-web, app-bridge-native, app-bridge-testing
  stream-kit-web, stream-kit-server
  notification-kit-react, notification-kit-server, notification-kit-web

Layer 2:
  app-bridge-react, app-bridge-react-native
  stream-kit-react, stream-kit-testing
  cast-kit-core, profile-kit, shell

Layer 3:
  cast-kit-react
  opengame-app, expo-bridge-demo, web-game-demo, stream-react-demo
```

Turbo parallelizes within each layer automatically.

## Test Runners

| Area | Runner | Config |
|------|--------|--------|
| `packages/*` | Vitest | Per-package `vitest.config.ts` (where present) |
| `services/api` | Vitest | `services/api/vitest.config.ts` |
| `apps/mobile` | Jest (Expo preset) | `apps/mobile/jest.config.js` (if present) |
| `examples/shell-single-game` | Vitest (`expo config --type introspect`) | `examples/shell-single-game/vitest.config.ts` |
| `packages/shell` runtime mutation | Stryker + Jest (apps/mobile's suites, in place) | `packages/shell/stryker.config.mjs`, `jest.mutation.config.js` |
| other `examples/*` | None (demo apps) | -- |

Run all tests: `pnpm test` (delegates to `turbo run test`).

## Config Locations

| Config | Location | Purpose |
|--------|----------|---------|
| `turbo.json` | Root | Task pipeline, caching, dependency graph |
| `tsconfig.json` | Root | Base TypeScript config extended by packages |
| `pnpm-workspace.yaml` | Root | Workspace package globs |
| `package.json` | Root | Root scripts, shared devDependencies |
| `.prettierrc` / `prettier` config | Root | Code formatting |
| `tsconfig.json` | Per-package | Extends root, sets package-specific paths |
| `tsup.config.ts` | Per-package (where present) | Bundle config for publishable packages |
| `vitest.config.ts` | Per-package (where present) | Test configuration |
| `wrangler.toml` | `services/api` | Cloudflare Worker config |
| `app.json` | `apps/mobile` | Expo app configuration |

## Cross-surface e2e (`e2e/`)

Standalone (not a workspace member; `pnpm install --ignore-workspace`). Needs the local API (8788),
launcher (5180), and for the couch flow the fake Chromecast (5181) and fixture game (5190).

| File | What |
|------|------|
| `e2e.config.ts`, `tests/*.e2e.ts` | tester.army `e2e`: launcher (web target) and API tests against the live local session; deterministic, no model |
| `couch-flow.mjs` | Phone, Mom, two iPads as WebSocket clients + the launcher in the fake Chromecast: cast once, follow, frame, swipe back, swap with 0 recasts, remote handoff |
| `fake-chromecast.mjs` | `/load` opens a view URL in a 1920×1080 recorded browser and counts loads (the app's `EXPO_PUBLIC_FAKE_CAST` target) |
| `fixture-game/server.mjs` | A stand-in game TV page that answers `ogs:start` with a resume point |

