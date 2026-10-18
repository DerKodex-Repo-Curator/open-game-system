# ogs manifest check and ogs publish: getting into the catalogue

Your game is in the OGS catalogue when its manifest, `ogs.manifest.json` at the root of your repo,
is approved. Two commands get it there: `ogs manifest check` tells you what's wrong with the
manifest before anyone else sees it, and `ogs publish` sends it to OGS for review. Both talk to the
public developer API under `/api/v1`; everything below works with `curl` too.

`ogs publish` uses your game's API key (`ogsk_…`), saved by `ogs login --app <appId> --key <key>`.
`ogs manifest check` needs no key.

## ogs manifest check

```sh
ogs manifest check                  # ./ogs.manifest.json
ogs manifest check path/to/ogs.manifest.json
ogs manifest check --offline        # the schema only, no network
```

It checks in two steps:

1. **Locally**, with `ManifestSchema` from `@open-game-system/ogs-protocol`. Each problem is an
   `issue` with the field's path (`startUrl`, `roles.0.audience`), and the API isn't called.
2. **On the API** (`POST /api/v1/manifests/check`): the catalogue's rules as `warning`s, and one GET
   each to your `startUrl` and `tvUrl` (5 s timeout, redirects not followed).

| Warning | What it means | Fix |
|---|---|---|
| `start_url_not_https` | `startUrl` is `http:` | Serve the phone page over https |
| `missing_art` | The art kit is missing `icon`, `cover`, `logo` or `heroClean` | See [Art and the catalogue](art-and-catalogue.md) |
| `no_kid_role` | No role has `audience: "kid"` | Add the kid's seat; a game for grown-ups gives every role `audience: "grownup"` |
| `start_url_unreachable` | `startUrl` answered something other than 2xx/3xx, or nothing within 5 s | Deploy it, or fix the URL |
| `tv_page_not_frameable` | `tvUrl` sends `X-Frame-Options: DENY`/`SAMEORIGIN`, or a CSP `frame-ancestors` that leaves out the OGS launcher (`https://tv.opengame.org`) | Drop the header, or allow `https://*.opengame.org` in `frame-ancestors` |

Room games with no static `tvUrl` (the phone page sends the room's TV URL at runtime) get no TV
page check. Warnings are what a reviewer looks at; they don't fail the check.

```text
$ ogs manifest check
warning missing_art: The art kit is missing cover, logo, heroClean
checked: startUrl 200, tvUrl 200, framed by the OGS launcher: yes
valid: comet-catch has no issues (1 warning)
```

```text
$ ogs manifest check
issue startUrl: Required
invalid: 1 issue
```

**Exit codes:** 0 valid (warnings or not), 1 issues, an unreadable file or an API error, 2 usage.

## ogs publish

```sh
ogs publish                         # submit ./ogs.manifest.json for review
ogs publish path/to/ogs.manifest.json
ogs publish --status                # where your entry stands
ogs publish --app <appId>           # another game you're logged in for
```

`ogs publish` validates the manifest locally (issues stop it, nothing is sent), then submits it as
your game's catalogue entry. The manifest's `appId` must be the game you're logged in as.

- A submission is **pending** until OGS reviews it. Submitting again replaces a pending submission.
- **Approved**, it's **live**: `GET /api/v1/catalogue` lists it, and the OGS app shows it.
- **Rejected**, the reviewer's note says why; fix it and publish again.
- A live game stays live while an update is pending or after an update is rejected. The update
  replaces it only when approved.

Run `ogs manifest check` first: the review looks at the same warnings.

```text
$ ogs publish
comet-catch: pending review (submitted 2026-10-18T12:00:00.000Z)
See where it stands: ogs publish --status

$ ogs publish --status
comet-catch: rejected (reviewed 2026-10-19T09:30:00.000Z)
note: The TV page shows a QR code when framed
```

**Exit codes:** 0 submitted (or status printed), 1 issues, not logged in or an API error
(printed as `code: message`), 2 usage.

## The endpoints

Errors are always `{ "error": { "code", "message", "status" } }` with that HTTP status.

### POST /api/v1/manifests/check

Public (no key), rate limited per IP. Body: a manifest. Answers 200 for any JSON body:

```json
{
  "valid": true,
  "issues": [],
  "warnings": [{ "code": "missing_art", "message": "The art kit is missing cover" }],
  "checked": { "startUrl": 200, "tvUrl": 200, "frameable": true }
}
```

`issues` are `{ path, message }` (path joined with `.`); `valid` is true when there are none. With
issues there are no warnings and no live checks. `checked` has only what was checked: no
`startUrl` when it didn't answer, no `tvUrl`/`frameable` without a `tvUrl`.

| Status | Code | When |
|---|---|---|
| 400 | `invalid_body` | The body isn't JSON |
| 429 | `rate_limited` | Too many checks from your IP; try again in a minute |

### PUT /api/v1/apps/:appId/catalogue-entry

`Authorization: Bearer <game API key>`. Body: the manifest. Stores it as pending:

```json
{ "appId": "comet-catch", "status": "pending", "submittedAt": 1792324800000 }
```

| Status | Code | When |
|---|---|---|
| 202 | | Stored for review |
| 400 | `invalid_body` | The body isn't JSON |
| 400 | `invalid_manifest` | Schema issues; `error.issues` lists them as `{ path, message }` |
| 400 | `app_id_mismatch` | The manifest's `appId` isn't `:appId` |
| 401 | `missing_auth` · `invalid_auth` · `invalid_api_key` | No key, not Bearer, or not a live key |
| 403 | `wrong_game` | The key belongs to another game |

### GET /api/v1/apps/:appId/catalogue-entry

Same key. The entry's status, with the live and pending manifests when there are any:

```json
{
  "appId": "comet-catch",
  "status": "pending",
  "submittedAt": 1792411200000,
  "reviewedAt": 1792324800000,
  "live": { "appId": "comet-catch", "name": "Comet Catch", "…": "…" },
  "pending": { "appId": "comet-catch", "name": "Comet Catch Deluxe", "…": "…" }
}
```

`status` is `none` (never submitted: only `appId` comes with it), `pending`, `live` or `rejected`
(with `note`). Same auth errors as the PUT.

### POST /api/v1/admin/catalogue-entries/:appId/approve · /reject

For OGS's reviewers: `Authorization: Bearer <OGS admin token>`. `/approve` makes the pending
manifest live; `/reject` takes `{ "note": "why" }`, drops the pending manifest and keeps the note
for the developer. Both answer 200 with the entry's status (as the GET above).

| Status | Code | When |
|---|---|---|
| 400 | `invalid_body` | `/reject` without a `note` |
| 401 | `unauthorized` | Missing or wrong admin token (with none configured, every call) |
| 404 | `nothing_pending` | No submission awaiting review |

### GET /api/v1/catalogue

Public. Every game in the catalogue, as manifests: OGS's own games, then approved entries in the
order they were first submitted. An approved entry with an OGS game's `appId` replaces it in place.
