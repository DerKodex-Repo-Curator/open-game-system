# The ogs CLI

`ogs` is the OGS developer tool. It adds OGS to a web game, runs the game with a fake OGS app and TV
(no device needed), checks and publishes the game's catalogue entry, deploys a no-app try path, sets up
the game's own App Store / Play Store app, and sends test pushes. Every command that needs OGS calls the
public developer API below, so a coding agent can do the same with plain HTTP.

> **Status: preview.** `ogs` is not on npm yet. Build it from the monorepo
> (`pnpm --filter @open-game-system/cli build`) and run `node packages/cli/dist/bin.mjs`, or link it
> (`pnpm --filter @open-game-system/cli exec pnpm link --global`) to get `ogs` on your PATH.

## Log in

Every command that changes something acts as your game, with the game's API key (the `ogsk_…` key your
game server already uses to send pushes; see [Notifications](notifications.md)).

```bash
ogs login --app comet-catch --key ogsk_...
```

The key is checked with the API and saved in `~/.config/ogs/credentials.json` (mode 0600). Every command
takes `--app <appId>`; without it, the app you logged in with last.

## Commands

| Command | What it does |
|---|---|
| `ogs init` | Adds OGS to an existing web game: the kits, `ogs.manifest.json`, the quickstart's code, an agent prompt |
| `ogs dev` | Runs the game with a fake OGS app and TV, with QR codes for real phones |
| `ogs manifest check` | Checks `ogs.manifest.json`: the schema, the catalogue's rules, the live URLs |
| `ogs publish` | Submits or updates the game's catalogue entry (reviewed); `--status` shows where it is |
| `ogs try` | Deploys the game's [try path](try-kit.md) and registers it with OGS |
| `ogs push send` | Sends a test push or push link to a player's handle (yours) |
| `ogs apps register` | Registers the game's own iOS / Android app (bundle id / package) |
| `ogs push credentials` | Uploads the app's APNs key / FCM service account (stored encrypted) |
| `ogs doctor` | Checks the app's registration, push credentials, link files and TV page |

Exit codes: 0 done, 1 something failed (the API's error code is printed), 2 wrong usage.

Environment: `OGS_API` (the API base; a preview while testing), `OGS_SITE` (the link domain `doctor`
checks, default `https://opengame.org`), `OGS_CONFIG_DIR` (default `~/.config/ogs`).

## Your game's own app

Ship the game as its own app with OGS's casting, sign-in and push (the white-label shell):

```bash
ogs apps register --ios tv.cometcatch.app --team-id ABCDE12345
ogs apps register --android tv.cometcatch.app --sha256 AA:BB:…:FF --google-client-id 123-abc.apps.googleusercontent.com
ogs push credentials --ios AuthKey_ABC123DEFG.p8 --key-id ABC123DEFG --team-id ABCDE12345
ogs push credentials --android service-account.json
ogs doctor --domain cometcatch.example
```

`apps register` needs your Apple team id (iOS), or your signing certificate's SHA-256 fingerprints and
the Google OAuth client ids your Android sign-in uses. `push credentials` checks the key is a real key and
stores it encrypted; nothing ever reads it back. `doctor` checks each step and says what to run next.

## The developer API

All under `https://opengame-api.jonathanrmumm.workers.dev/api/v1` (a preview has its own base). Auth
"game key" = `Authorization: Bearer ogsk_…` for that `:appId` (403 `wrong_game` otherwise). Errors are
`{ "error": { "code", "message", "status" } }`.

| Method | Path | Auth | Body → answer |
|---|---|---|---|
| PUT | `/apps/:appId/native/ios` | game key | `{ bundleId, teamId }` → 201 new / 200 updated; 409 `app_id_taken` |
| PUT | `/apps/:appId/native/android` | game key | `{ package, sha256CertFingerprints, googleClientIds }` → 201 / 200 |
| GET | `/apps/:appId/native` | game key | → `{ apps: [...] }` |
| PUT | `/apps/:appId/push-credentials` | game key | `{ ios: { p8, keyId, teamId } }` or `{ android: { serviceAccount } }` → 204; 409 `app_not_registered`, 400 `invalid_credentials` |
| GET | `/apps/:appId/push-credentials` | game key | → what's configured (ids only) |
| GET | `/apps/app-links` | none | → every registered app (for link files) |
| POST | `/games/:appId/notifications` | game key | `{ to: [handle], title, body, url?, tag?, whenOpen? }` → `{ results: [{ to, status }] }` |

The commands' own pages list the rest of their endpoints.
