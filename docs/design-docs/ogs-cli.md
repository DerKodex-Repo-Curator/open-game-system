# `ogs`: the OGS developer tool and its public API

Status: **contract, building** (2026-10-18, branch `claude/shell-platform`) · ADR:
[2026-10-18-ogs-developer-api.md](../adrs/2026-10-18-ogs-developer-api.md) · Shell commands:
[white-label-shell.md](white-label-shell.md)

`ogs` (package `@open-game-system/cli`, `packages/cli`) is how a game developer (or their coding agent)
adds a game to OGS, runs it locally with no device, checks and publishes it, deploys a no-app try path,
sets up its own white-label app, and tests pushes. Every command that needs OGS talks to a public,
documented API under `/api/v1`; the docs site has a page per command group and `llms.txt` lists them.

## Shared conventions (all commands)

- **Identity = the game's API key** (`ogsk_…`, `Authorization: Bearer`), saved by `ogs login`. Routes with
  `:appId` check the key belongs to that game (403 `wrong_game`), as `POST /games/:appId/notifications`
  already does. No other developer account in v1.
- **Errors** are the API's `{ error: { code, message, status } }`; the CLI prints `code: message` and exits 1.
  Usage errors exit 2. Success exits 0.
- **The manifest file** is `ogs.manifest.json` at the game's repo root (the starter template's name),
  validated with `ManifestSchema` from `@open-game-system/ogs-protocol`.
- **Environment:** `OGS_API` (API base, a preview in tests), `OGS_SITE` (link domain, default
  opengame.org), `OGS_CONFIG_DIR` (default `~/.config/ogs`), `OGS_DOCS` (docs/kits base, default
  `https://ogs-docs.pages.dev`).
- **Code layout:** one command per file in `packages/cli/src/commands/`, one entry in
  `src/commands/index.ts`. Shared helpers in `src/io.ts` (`call`, `session`, `getJson`, …). Every command
  is `run(io, args)`; tests pass a fake `Io`; API seam tests run the real CLI against the real routes and a
  local D1 (`services/api/test/cli-*.test.ts`).
- **API layout:** one Hono router per group in `services/api/src/routes/`, mounted in `src/index.ts`;
  new tables `CREATE TABLE IF NOT EXISTS` appended to `schema.sql`; rows in `docs/architecture.md`.

## Commands and their endpoints

| Command | What it does | Endpoint(s) | Group |
|---|---|---|---|
| `ogs login` · `apps register` · `push credentials` · `doctor` | the white-label shell setup (built) | `/api/v1/apps/:appId/native/*`, `/push-credentials`, `/app-links` | shell (done) |
| `ogs manifest check [file]` | validate `ogs.manifest.json` locally (schema) and on the API (schema + catalogue rules + live checks) | `POST /api/v1/manifests/check` (public) | catalogue |
| `ogs publish [file]` | submit or update the game's catalogue entry; prints its review status | `PUT /api/v1/apps/:appId/catalogue-entry`, `GET` same (game key); `POST /api/v1/admin/catalogue-entries/:appId/approve` · `/reject` (admin token) | catalogue |
| `ogs init` | add OGS to an existing web game: kits, manifest, the quickstart's code, an agent prompt | `GET /api/v1/dev/kits` (public) | init |
| `ogs dev` | run the game with a fake OGS app and fake TV, plus QR codes for real phones; no device needed | none: local (its own JWKS for game tokens) | dev |
| `ogs try` | deploy the game's try-kit try path and register its URL with OGS | `PUT /api/v1/apps/:appId/try` · `GET` same (game key) | deliver |
| `ogs push send` | a test push or push link to a player handle (yours) | `POST /api/v1/games/:appId/notifications` (existing) + `GET /api/v1/games/:appId/push-handles/:handle` (game key) | deliver |

### `POST /api/v1/manifests/check` (public, rate limited per IP)

Body: a manifest (JSON). Answer 200 always for a JSON body:
`{ valid: boolean, issues: [{ path: string, message: string }], warnings: [{ code, message }], checked: { startUrl?: number, tvUrl?: number, frameable?: boolean } }`.
- `issues`: `ManifestSchema` errors (path joined with `.`). `valid` = no issues.
- `warnings` (catalogue rules, from `services/api/test/catalogue.test.ts` and `apps/docs/content/rules.md`):
  `start_url_not_https`, `missing_art` (icon, cover, logo, heroClean), `no_kid_role` (unless the game is
  for grown-ups: every role audience `grownup`), `tv_page_not_frameable` (X-Frame-Options or CSP
  frame-ancestors blocks opengame launcher origins), `start_url_unreachable` (status ≠ 2xx/3xx).
- Live checks: one GET each to `startUrl` and `tvUrl` (5 s timeout, no body read past headers).
CLI: validates locally first (no network needed); `--offline` skips the API.

### `PUT /api/v1/apps/:appId/catalogue-entry` (game key)

Body: the manifest (its `appId` must equal `:appId`, else 400 `app_id_mismatch`). Validated like
`/manifests/check` (issues → 400 `invalid_manifest` with the issues). Stores the entry as
`pending` (a new submission replaces a pending one; a live entry stays live until the update is
approved). → 202 `{ appId, status: "pending", submittedAt }`.
`GET` → `{ appId, status: "pending" | "live" | "rejected" | "none", submittedAt?, reviewedAt?, note?, live?: Manifest, pending?: Manifest }`.
Admin: `POST /api/v1/admin/catalogue-entries/:appId/approve` · `/reject { note }` with
`Authorization: Bearer <OGS_ADMIN_TOKEN>` (a Worker secret; unset refuses all). Approve makes the
pending manifest live. `GET /api/v1/catalogue` = the seed (`catalogue.ts`) with live entries added or
replacing seed entries by appId. Table `catalogue_entries(app_id, status, manifest_json, pending_json,
submitted_at, reviewed_at, note)`.

### `GET /api/v1/dev/kits` (public, cache 5 min)

`{ docs: "https://ogs-docs.pages.dev", llms: ".../llms.txt", quickstart: ".../quickstart.md", kits: [{ name: "@open-game-system/profile-kit", file: "profile-kit.tgz", url }, …] }`
(profile-kit, cast-kit-core, cast-kit-react, try-kit; urls under `<docs>/pkg/`).
`ogs init`: detects the package manager (lockfile) and framework (Vite / plain / Next / TanStack Start);
writes `ogs.manifest.json` from flags (`--app-id`, `--name`, `--start-url`, `--tv-url`, `--shape`,
`--tv`) or prompts; downloads kits into `vendor/` and adds `file:vendor/…` deps; writes
`OGS.md` (the quickstart's checklist for this repo with the agent prompt and llms.txt link); with
`--codemod`, adds the TV page's launcher hookup and the phone page's profile hookup where it can find
the entry files (never overwrites: it prints a diff when unsure). `--dry` prints the plan only.

### `ogs dev` (local)

Serves on `http://localhost:4747` (`--port`): a harness page with the game's TV page framed as the OGS
launcher frames it (sends `ogs:start` with a fake couch, `ogs:suspend` / `ogs:resume` buttons), one or
more phone frames (the start URL with a fake app bridge: profile, cast, session stores, from
`@open-game-system/app-bridge-testing`), and QR codes of the start URL on the LAN address for real
phones. Fake game tokens are ES256-signed by a key `ogs dev` makes; it serves
`/.well-known/jwks.json` so the game's server verifies with `OGS_JWKS_URL=http://localhost:4747/.well-known/jwks.json`.
Reads `ogs.manifest.json` (`--manifest`); `--start-url` / `--tv-url` override.

### `PUT /api/v1/apps/:appId/try` (game key)

Body `{ url }` (https, must answer `GET /` with a redirect to a TV page, and `GET /ws-probe` with 426
when not a WebSocket: try-kit's routes). OGS checks both, then stores it: 200
`{ appId, url, checkedAt }`; 422 `try_path_not_found` with what failed. `GET` returns it (404 `no_try_path`).
`GET /api/v1/catalogue` adds `tryUrl` to that game's manifest (optional field in `ManifestSchema`).
`ogs try`: runs the game's `deploy:try` script (or `--command`), reads the deployed URL from its
output (or `--url`), then registers it; `--check-only` skips the deploy.

### `ogs push send` (game key)

`ogs push send --to <handle> [--title] [--body] [--url <link>] [--when-open deliver|banner]` posts to the
existing `POST /api/v1/games/:appId/notifications` and prints each handle's status. New
`GET /api/v1/games/:appId/push-handles/:handle` → `{ handle, surfaces: [{ kind: "ogs" | "web" | "app", lastActiveAt }] }`
(no ids, no tokens) lets the CLI say where a test would go (`--check`). How to get your own handle
(`requestOgsNotifications()` in the game page, or the PWA's subscribe) is on the docs page.

## Docs (apps/docs/content)

One page per group, registered in `apps/docs/src/pages.ts` by the integrator: `cli.md` (install, login,
conventions, every command at a glance), `cli-catalogue.md`, `cli-init.md`, `cli-dev.md`,
`cli-deliver.md` (try + push), plus the existing `try-kit.md`. The API endpoints above go in a page
section "The developer API" in `cli.md` and in `docs/architecture.md`.
