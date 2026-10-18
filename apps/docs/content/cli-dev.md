# ogs dev: run your game with a fake OGS app and TV

`ogs dev` runs your game on your computer as OGS would run it, with no phone, TV or OGS account:
a fake TV launcher frames your TV page and starts it with a fake couch, fake phones open your start
page with a fake OGS app bridge (so profile-kit sees a signed-in player), and QR codes let real
phones on your Wi-Fi join. It signs its own game tokens and serves their public key, so your game's
server verifies them exactly as it verifies real ones. Nothing goes to the OGS API: it works offline.

Start your game's dev server first (for example `pnpm dev`), then, in the game's repo:

```sh
ogs dev
```

and open `http://localhost:4747`.

## What you see

`http://localhost:4747` is the harness page:

- **The TV**: your `tvUrl` in a 16:9 frame, as the OGS TV launcher frames it. When the frame
  loads (and again whenever the page posts `ogs:ready`) the harness posts `ogs:start` with the
  fake couch: `instanceId`, `mode: "new"`, `roster` (each player in your manifest's roles, in order;
  `player` when you have none), `players` and a game `token`. That is the same message the real
  launcher sends (see [Messages](messages.md)), so `getOgsSessionSource()` / `useOgsSession()` in
  [profile-kit](profile-kit.md) gets a session.
- **Buttons** `ogs:suspend` and `ogs:resume` post those messages to the TV page (what Home and
  Continue do on a real TV), so you can check `onOgsPause` silences your game. **Reload TV** reloads
  the frame (a new `ogs:start` follows).
- **The phones**: one frame per player (two by default) showing your `startUrl` with the fake app
  bridge. `getOgsProfileSource()` / `useOgsProfile()` gives each its own player: Ada, Sam, Rae, Kit,
  Lou, Ivo, with a profile token for your game.
- **Real phones**: a QR code per fake phone (that player's page, fake bridge included, on your LAN
  address) and one of your plain start URL on the LAN (to try it in a phone's browser, where there
  is no OGS profile, or in the OGS app).
- **Messages**: everything the launcher sent the TV, the TV sent the launcher (`ogs:ready`,
  `ogs:room`, `ogs:instance`, `ogs:resume-point`), and each phone sent the app.

A room-based game has no `tvUrl`: its phone page names the room's TV page at runtime with cast-kit
(`useCastViewUrl`). The harness shows that page in the TV frame as soon as a phone sends it
(`SET_VIEW_URL` on the `cast` store). `--tv-url` sets one up front instead.

## The fake couch and its tokens

Every run makes a new P-256 key (kept in memory only), a new couch session (`sid`) and a new
sitting (`instanceId`). Tokens are signed fresh each time a page loads, and live an hour, like real
ones:

| Token | Where | Claims |
|---|---|---|
| TV session token | `ogs:start` `token` | `iss: "http://localhost:4747"`, `aud`: your appId, `sub`/`handle`/`name`/`avatar`: the host (the first player), `sid`, `players`, `couch: { sid, label }`, `iat`, `exp` |
| Phone profile token | the `profile` bridge store (`useOgsProfile().token`) | the same, for that player, with `couch` and without `sid` or `players` |

Avatars are plain coloured discs with the player's initial, as `data:` URLs (so they load on a real
phone too).

### Verifying them on your game's server

Point profile-kit's verifier at `ogs dev`'s key set while you develop:

```sh
OGS_JWKS_URL=http://localhost:4747/.well-known/jwks.json pnpm dev
```

```ts
import { verifyOgsToken } from "@open-game-system/profile-kit/server";

const claims = await verifyOgsToken(token, {
  appId: "rocket-crew",
  jwksUrl: process.env.OGS_JWKS_URL, // unset in production: the real OGS key set
});
```

A token from `ogs dev` never verifies against production OGS (a different key), and a token for
another appId is rejected, as in production. Restarting `ogs dev` makes a new key: reload your pages.

## The fake phones

Phone *n* is your start URL served through its own port, `4747 + n` (`http://localhost:4748/…`,
`http://localhost:4749/…`). Each phone is its own origin, so each has its own storage and cookies,
like a separate device. The proxy passes every request to your dev server (WebSockets too: your
game's room socket and Vite's hot reload) and changes only this:

- Into every HTML page it puts the fake app first in `<head>`: `window.ReactNativeWebView`, which
  answers the bridge's `BRIDGE_READY` with these stores, as the OGS app does:

  | Store | State | The fake app answers |
  |---|---|---|
  | `profile` | `{ status: "ready", profile: { id, handle, name, avatar, token } }` | |
  | `cast` | connected to "ogs dev TV", `viewUrl`: your `tvUrl` | `SET_VIEW_URL`: sets `viewUrl` and shows it in the TV frame |
  | `notifications` | `{ answer: null, last: null }` | `REQUEST`: granted, with a `ph_dev…` push handle (`requestOgsNotifications()`) |
  | `ogs` | `{ reported: [] }` | `INSTANCE_REPORT`: adds the title (`reportOgsSitting()`) |

- It drops `X-Frame-Options` and `Content-Security-Policy` from the answers (so the harness can frame
  the page and run the fake app), and points redirects on your game's origin back at the phone's port.

Requests your phone page makes to *another* origin (an API on its own port, say) leave from the
phone's origin (`localhost:4748`), so that server must allow it with CORS while you develop.

The TV page is not proxied: it is framed straight from your `tvUrl`, as the launcher frames it, so it
must allow being framed (no `X-Frame-Options: DENY`, no `frame-ancestors` that leaves out the
launcher). `ogs manifest check` tests that against the real launcher's origins.

## Real phones

The QR codes use your computer's LAN address (the first non-internal IPv4; `--lan` picks another).
`ogs dev` listens on every interface, so a phone on the same Wi-Fi reaches the harness's phones as
they are. The plain start URL QR needs your game's dev server to listen on the LAN as well
(`vite --host`, `next dev -H 0.0.0.0`). A phone's browser is a plain browser: it has the fake bridge
only through a fake phone's QR code.

## Flags

| Flag | Default | |
|---|---|---|
| `--manifest <file>` | `ogs.manifest.json` | the manifest to read (validated with `ManifestSchema`) |
| `--start-url <url>` | the manifest's `startUrl` | the phone page (http or https) |
| `--tv-url <url>` | the manifest's `tvUrl` | the TV page |
| `--port <n>` | `4747` | the harness; the phones take the next ports |
| `--phones <n>` | `2` | fake phones (players), 1 to 6 |
| `--lan <ip>` | your LAN address | the address in the QR codes |

The manifest's `startUrl` is usually the production URL: pass your dev server's with `--start-url`
(`ogs dev --start-url http://localhost:5173/ --tv-url http://localhost:5173/tv`), or keep a
development manifest and pass it with `--manifest`.

## What it serves

All local; there is no OGS API endpoint for `ogs dev`.

| Request | Answer |
|---|---|
| `GET http://localhost:4747/` | the harness page (fresh tokens each load) |
| `GET http://localhost:4747/.well-known/jwks.json` | `{ keys: [{ kty: "EC", crv: "P-256", x, y, kid: "ogs-dev-…", alg: "ES256", use: "sig" }] }`, any origin may read it (`Access-Control-Allow-Origin: *`) |
| `http://localhost:<4747 + n>/…` | phone *n*: your start URL's origin, proxied, with the fake app in every HTML page; `502` with a hint when your dev server doesn't answer |

## Exit codes

| Code | When |
|---|---|
| `0` | stopped with Ctrl-C |
| `1` | no manifest, not JSON, not a valid manifest (each issue is printed), or the port (or a phone's port) is taken |
| `2` | a bad flag: `--phones` outside 1 to 6, `--port` not a number, a URL that isn't http or https |

## Example

```console
$ ogs dev --start-url http://localhost:5173/ --tv-url http://localhost:5173/tv
ogs dev: Rocket Crew (rocket-crew)

  Harness   http://localhost:4747   (TV page + 2 phones: open this)
  TV page   http://localhost:5173/tv
  Phone 1   http://localhost:4748/
  Phone 2   http://localhost:4749/

  Real phones on this Wi-Fi: scan the QR codes in the harness (http://192.168.1.20:4747).
  Your game's dev server must listen on the LAN too (vite --host) for http://192.168.1.20:5173/.

  Game server: verify tokens with OGS_JWKS_URL=http://localhost:4747/.well-known/jwks.json
  Ctrl-C stops.
```
