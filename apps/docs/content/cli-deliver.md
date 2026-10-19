# Deliver: `ogs try` and `ogs push send`

Two commands for getting your game to players outside the catalogue tile: a **try path** strangers can
play from one link with no app (`ogs try`), and **test pushes** to your own handle (`ogs push send`).
Both use your game's API key, saved by `ogs login --app <appId> --key <ogsk_…>`, and both talk to the
public developer API under `/api/v1`.

Exit codes for both: `0` it worked, `1` it failed (the CLI prints the API's `code: message`), `2` usage.

## `ogs try`

Deploys your game's try path (the Worker built with [try-kit](try-kit.md), in your own Cloudflare
account) and registers its URL with OGS. OGS checks the URL first, then the catalogue offers it as your
game's `tryUrl` ("Try it in your browser").

```sh
ogs try                                  # pnpm run deploy:try, read the URL, register it
ogs try --command "wrangler deploy -c wrangler.try.jsonc"
ogs try --url https://try.comet.example  # deploy, but register this URL
ogs try --check-only --url https://comet-try.you.workers.dev   # no deploy: check and register
ogs try --check-only                     # re-check the URL already registered
```

What it does:

1. Runs your repo's `deploy:try` script with the package manager its lockfile names (`pnpm-lock.yaml`
   → pnpm, `yarn.lock` → yarn, `bun.lock`/`bun.lockb` → bun, else npm), or the `--command` you give.
   The command's output streams to your terminal. A non-zero exit stops here.
2. Reads the deployed URL from that output: the last `https://….workers.dev` URL it printed, else the
   last `https://` URL. `--url` overrides it (a custom domain, say).
3. Sends it to `PUT /api/v1/apps/<appId>/try` and prints `ok   try path <url> registered for <appId>`.

Add the script once:

```json
{ "scripts": { "deploy:try": "wrangler deploy -c wrangler.try.jsonc" } }
```

| Flag | Meaning |
|---|---|
| `--command "<cmd>"` | Run this instead of the `deploy:try` script |
| `--url <https URL>` | The deployed URL (instead of reading it from the output) |
| `--check-only` | Skip the deploy; check and register `--url`, or the URL already registered |
| `--app <appId>` | Another game you logged in with (default: the last one) |

### What OGS checks

A try path is try-kit's two routes. OGS sends one request to each (5 s timeout, redirects not followed):

- `GET <url>/` must answer a redirect (3xx with a `Location`) to a new room's TV page
  (`tvStartPath` in `@open-game-system/try-kit/worker`).
- `GET <url>/ws-probe` without an `Upgrade` header must answer `426` (`wsProbe`).

If either fails, nothing is stored and the CLI prints which one, for example:

```text
$ ogs try --url https://example.com --check-only
Checking https://example.com (GET / and /ws-probe)…
try_path_not_found: GET https://example.com/ answered 200, not a redirect to a TV page; GET https://example.com/ws-probe answered 200, not 426 (try-kit's wsProbe)
```

### `PUT /api/v1/apps/:appId/try` (game key)

```http
PUT /api/v1/apps/comet-catch/try
Authorization: Bearer ogsk_…
Content-Type: application/json

{ "url": "https://comet-try.you.workers.dev" }
```

| Answer | When |
|---|---|
| `200 { "appId": "comet-catch", "url": "https://comet-try.you.workers.dev", "checkedAt": "2026-10-18T15:00:00.000Z" }` | Both checks passed; the URL is stored (a newer one replaces it) |
| `422 try_path_not_found` | A check failed; `message` names each failed check |
| `400 invalid_body` | `url` missing or not `https://` |
| `401 missing_auth` / `invalid_api_key` · `403 wrong_game` | No key, a bad key, or another game's key |

`GET /api/v1/apps/:appId/try` (game key) answers the same `200` body, or `404 no_try_path`.

`GET /api/v1/catalogue` then includes `"tryUrl": "<url>"` in your game's manifest (an optional
manifest field; you never set it yourself).

## `ogs push send`

Sends a real push through the same endpoint your server uses (there is no test-only send path), to one
or more push handles, and prints each handle's status.

```sh
ogs push send --to ph_… --title "Test" --url https://comet.example/room/ABCD
ogs push send --to ph_one…,ph_two… --when-open banner
ogs push send --to ph_… --check          # where it would go; sends nothing
```

```text
ph_x4P…  sent
```

| Flag | Meaning |
|---|---|
| `--to <handle>[,<handle>]` | Push handles (`ph_…`), comma-separated, up to 100 (required) |
| `--title <text>` | Default `Test push` (60 characters at most) |
| `--body <text>` | Default `A test push from ogs push send.` (180 at most) |
| `--url <link>` | Where a tap opens; on your game's origin. Default: your `startUrl` |
| `--when-open deliver\|banner` | If the game is open and in front: hand it to the page (default) or show the banner anyway |
| `--check` | Don't send: list where each handle would go |
| `--app <appId>` | Another game you logged in with |

Each handle's status is the send API's: `sent` (a surface took it), `not_permitted` (not this game's
handle, or the player turned pushes off), `gone` (no surface left), `failed` (every surface errored; try
later). It exits `0` only when every handle is `sent`. See [Notifications](notifications.md) for what
each means for your server.

`--check` prints the handle's surfaces in the order OGS tries them (most recently active first), and
exits `1` when a handle has none or isn't your game's:

```text
$ ogs push send --to ph_x4P… --check
ph_x4P…  web (last active 2026-10-18T12:00:00.000Z), then ogs (last active 2026-10-18T10:00:00.000Z)
```

### Getting your own handle

A handle is what your game gets when a player opts in, so opt in as a player on your own phone:

- **In the OGS app:** open your game, and from a tap call `requestOgsNotifications()` (profile-kit).
  Allow the app's sheet; the answer is `{ status: "granted", handle }`.
- **In your PWA or a browser tab:** `subscribeOgsPush({ appId })` (notification-kit-web) from a tap.
  Allow the browser's prompt; the answer is the same.

Log the handle (or show it on a debug screen) and pass it to `--to`. In the OGS app, opting in again
from the same profile gives the same handle. A kid's iPad is always denied: use a grown-up's phone.

### `POST /api/v1/games/:appId/notifications` (game key)

The existing send endpoint, as [Notifications](notifications.md) describes:
`{ to: [handle], title, body, url?, tag?, whenOpen? }` → `200 { results: [{ to, status }] }`, one per
handle in order.

### `GET /api/v1/games/:appId/push-handles/:handle` (game key)

Where a push to this handle would go. Read-only; no ids, devices or tokens in the answer.

```json
{
  "handle": "ph_x4P…",
  "surfaces": [
    { "kind": "web", "lastActiveAt": "2026-10-18T12:00:00.000Z" },
    { "kind": "ogs", "lastActiveAt": "2026-10-18T10:00:00.000Z" }
  ]
}
```

| `kind` | Meaning |
|---|---|
| `ogs` | The OGS app on a grown-up's phone |
| `app` | Your own white-label app on a grown-up's phone |
| `web` | A web push subscription on your game's origin (your PWA or a browser) |

`lastActiveAt` is when the player last opened your game there. An empty `surfaces` means a push goes
nowhere. Errors: `404 handle_not_found` (unknown, or another game's handle), `401` / `403 wrong_game`
as above.
