# Multi-tenant push: OGS sends for each white-label app with that app's own credentials

Date: 2026-10-18 · Status: Accepted · Design: [white-label-shell.md](../design-docs/white-label-shell.md) (decisions 3, 4, 6, 8, 15)

## Context

Today every push goes to one app, `org.opengame.app`, through Expo's push service with OGS's own
`EXPO_ACCESS_TOKEN`. A white-label app (Rocket Crew's own App Store app, `tv.rocketcrew.app`) is built
in the developer's EAS account under the developer's Apple team. Apple only delivers a push to that
app when it is signed with a key from that team, and Expo would need the developer's own Expo
project. The design says OGS hosts push: the developer uploads their APNs key and FCM service
account, and games keep using the same send API.

Checked 2026-10-18: a Cloudflare Worker reaches APNs directly (api.sandbox.push.apple.com answered
`403 {"reason":"InvalidProviderToken"}` to a probe Worker, an HTTP/2 answer) and FCM's HTTP v1 API.
No relay is needed.

## Decision

1. **Apps are registered.** `native_apps` maps a store identity to an OGS game: iOS `bundle_id` with
   its Apple `team_id`; Android `package` with its signing-certificate SHA-256 fingerprints; and the
   Google OAuth client ids its sign-in tokens carry. One appId may have one iOS and one Android app.
2. **Owner = the game's API key.** Registering an app and uploading its credentials need a game API
   key for that appId (the `ogsk_…` key a game server already uses to send pushes). There is no other
   developer account in v1; `ogs login` stores that key. A new scope is not added: whoever can send
   the game's pushes can configure where they go.
3. **Credentials are stored encrypted.** `app_push_credentials` holds one row per app and platform:
   the APNs `.p8` (with `key_id`, `team_id`) or the FCM service account JSON, AES-GCM encrypted under
   a key derived from the Worker secret `PUSH_KEY_SECRET` (as VAPID keys are), with a fresh IV per
   row. The API never returns them; a GET says only what is configured (ids, not secrets).
4. **Devices belong to an app.** The shell registers its native token per app: `app_devices`
   (device id, appId, platform, bundle id / package, token, token kind `apns` | `fcm`, and for APNs
   the environment `sandbox` | `production`). The OGS app's Expo `devices` rows are unchanged.
5. **Sending picks the app.** For a game's push (`POST /api/v1/games/:appId/notifications`, unchanged)
   to a profile, OGS sends to that profile's OGS-app phones (Expo, as today) **and** to the profile's
   devices running *this game's* white-label app, with this app's credentials: APNs with an ES256
   provider token (`apns-topic` = the bundle id, the device's environment), FCM HTTP v1 with an OAuth
   token minted from the service account. A device of another white-label app never receives it.
6. **Links.** `GET /api/v1/apps/app-links` (public) lists every registered app; opengame.org's
   `apple-app-site-association` and `assetlinks.json` are generated from it plus the OGS app's own
   entry, with each registered app first for `/play/<appId>` and `/play/<appId>/*` (iOS uses the first
   installed app whose paths match, so the OGS app stays the fallback).

## Consequences

- One misconfigured app can't break another: credentials, registration and devices are per app;
  a dead token (APNs 410 / FCM UNREGISTERED) removes only that `app_devices` row.
- `PUSH_KEY_SECRET` now protects developers' keys: rotating it needs a re-encrypt step (not in v1).
- APNs provider tokens are cached per credential for 50 minutes (Apple asks for 20-60 min reuse).
- The API path is `/api/v1/...` like every other route; the design's `/v1/...` is shorthand.
- Sign in with Apple / Google tokens are accepted for any registered app's bundle id / Google client
  id, as well as the OGS app's (`APPLE_CLIENT_IDS`, `GOOGLE_CLIENT_IDS`).
