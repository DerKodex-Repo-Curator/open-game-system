# Messages and manifest

The exact shapes OGS and a game exchange. The tables on this page are **generated from the zod
schemas** in [packages/ogs-protocol](../../../packages/ogs-protocol/src/frame.ts) when the site is
built, so they match the code. When anything here and the code disagree, the code wins.

With profile-kit you do not post or parse these by hand: see
[profile-kit reference](profile-kit.md). This page is for games that do, for tests that fake the
launcher, and for agents that want the precise contract.

## Transport

- The launcher and the TV page talk with `window.postMessage`. Each message is a plain object with a
  `type` field.
- The launcher posts to your iframe's `contentWindow`. Your page posts to `window.parent` (profile-kit
  uses target origin `"*"`; the launcher checks the origin instead).
- The launcher accepts game messages only from the origin of the current game's TV URL, and drops
  anything that fails `GameToLauncherSchema`. An `ogs:instance` without a `title` labels nothing.
- Validate what you receive: ignore anything whose `event.source` is not `window.parent`, and parse
  with the schema (`LauncherToGameSchema.safeParse(event.data)`). Unknown messages are ignored, never
  errors.
- Every message is optional for the game. A game that answers nothing still runs.

## Launcher → game

`LauncherToGameSchema` in [frame.ts](../../../packages/ogs-protocol/src/frame.ts).

<!-- schema:launcher-to-game -->

## Game → launcher

`GameToLauncherSchema` in [frame.ts](../../../packages/ogs-protocol/src/frame.ts).

<!-- schema:game-to-launcher -->

## Phone page → app

In the OGS app's WebView a game page talks to the app over the app bridge, not `postMessage` to a
parent. profile-kit uses two bridge stores:

| Store | Direction | Content |
|---|---|---|
| `profile` | app → page | `{ status: "asking" }`, `{ status: "ready", profile: OgsProfile }` or `{ status: "none" }` |
| `ogs` | page → app | event `{ type: "INSTANCE_REPORT", report: InstanceReport }` (`OgsBridgeEventSchema`) |
| `haptics` | page → app | events `IMPACT` / `NOTIFY` (`HapticsBridgeEventSchema`, below): the device taps the player's hand |
| `account` | both | single-game apps: state `{ login, signingIn }`, event `SIGN_IN` shows the app's native sign-in sheet (below) |

Room games declare their TV page with cast-kit's `useCastViewUrl(url)`; the app forwards it to the
launcher. See [the contract, §3](contract.md#3-phones-the-game-page-in-the-apps-webview).

### Haptics

`HapticsBridgeEventSchema` in [native.ts](../../../packages/ogs-protocol/src/native.ts). Send from a
tap or a game moment; an app without haptics ignores them.

<!-- schema:haptics -->

### Account (single-game apps)

In a game shipped as its own app with the OGS shell, players start as guests (a device profile).
The game has no sign-in UI: it dispatches `SIGN_IN` (for example from a "Save your progress"
button shown while `login` is `"guest"`) and the app shows its native sheet (Sign in with Apple, or
Google on Android). The signed-in player then arrives through the `profile` store.
`AccountBridgeStateSchema` and `AccountBridgeEventSchema` in
[native.ts](../../../packages/ogs-protocol/src/native.ts).

State:

<!-- schema:account-state -->

Events:

<!-- schema:account-events -->

## A typical sequence

```
launcher                                   your TV page (iframe)
   |  load iframe (allow="autoplay; fullscreen")  |
   |--- ogs:start {instanceId, mode, roster, token, players} --->|
   |<-------------------------- ogs:ready ---------------------- |  (profile-kit, on start-up)
   |--- ogs:start (again, for the current sitting) ------------> |
   |<---------- ogs:instance {report: {title: "Mission 1"}} ---- |
   |              ... the couch plays ...                        |
   |--- ogs:suspend -------------------------------------------> |  Home: go silent, stay loaded
   |--- ogs:resume --------------------------------------------> |  Continue: sound back, no reload
```

## Manifest

A game is config, not code: one `Manifest` (`ManifestSchema` in
[manifest.ts](../../../packages/ogs-protocol/src/manifest.ts)). Fields with a default may be left out.

<!-- schema:manifest -->

An example:

```json
{
  "appId": "space-bakery",
  "name": "Space Bakery",
  "tagline": "Bake for aliens, together.",
  "shape": "couch",
  "tv": "required",
  "startUrl": "https://space-bakery.example.com/",
  "roles": [
    { "id": "chef", "label": "Chef", "audience": "grownup" },
    { "id": "helper", "label": "Helper", "audience": "kid" }
  ],
  "art": {
    "icon": "/art/space-bakery/icon.png",
    "cover": "/art/space-bakery/cover.jpg",
    "logo": "/art/space-bakery/logo.png",
    "heroClean": "/art/space-bakery/hero-clean.jpg",
    "tile": "/art/space-bakery/tv.jpg"
  },
  "shop": { "ages": "4+", "minutes": [10, 20], "players": "2-4" }
}
```

No `tvUrl`: this is a room game whose phone page declares the room's TV page at runtime. A game with
one TV page for everyone adds `"tvUrl": "https://space-bakery.example.com/tv"`.

## Shared types

<!-- schema:types -->
