# Observability

How OGS logs, what the clients report, and how /sre-agent watches it. Shape and rules come from
the /wide-events-logging and /client-telemetry skills; this page records what this repo does.

## Workers

| Worker | Name (wrangler) | Config | Observability on | `CF_VERSION_METADATA` | Watched by sre-agent |
|--------|-----------------|--------|------------------|-----------------------|----------------------|
| API (HTTP, CouchSession DO, client events) | `opengame-api` | `services/api/wrangler.jsonc` | yes, `head_sampling_rate: 1` | yes | yes |
| API PR previews | `opengame-api-pr-<n>` | rendered by `services/api/scripts/render-preview-wrangler.mjs` | yes | yes | no (short-lived) |

Not Workers (no Workers Logs): `apps/tv` (Pages project `ogs-tv`) and `apps/web` (Pages project
`opengame-org`, which serves the Cast receiver `public/receiver.html`) are static Pages sites with no
Functions. The GPU stream server runs on Cloud Run (`stream-gpu`), outside Cloudflare. The shared
`sre-notify` Worker lives in the skills repo.

## Server wide events

One wide event per unit of work, emitted as an object (Workers Logs indexes its fields):
`console.info(obj)` when it went well, `console.error(obj)` with `error: { type, message, stack }`
when it failed. Code: `services/api/src/lib/wide-event.ts` (`emit`, `errorFields`, `scrub`,
`requestEvent`, `recordError`), the request middleware `services/api/src/middleware/wide-event.ts`.

Every line has `event`, `service: "opengame-api"`, `version` (the deployed version id, `dev`
locally), `source: "server"`, `outcome: "ok" | "error"`.

- Handlers add context to the request's line with `requestEvent(c)` (ids, counts, flags) and
  `recordError(c, error)` for a failure they caught and answered as 5xx themselves.
- Unhandled errors answer the error contract (`500 internal_error`) through `app.onError`; the
  middleware logs them once (Hono's default `console.error` is gone).
- 4xx answers are the client's problem: info lines, not errors.
- `error.message` is the grouping key: keep it stable (`"Room not found"`, never `"Room r-91 not
  found"`); put ids in fields.

## Client telemetry

The app and the Cast receiver post batches to `POST /api/v1/client-events`
(`services/api/src/routes/client-events.ts`), which writes each event as one JSON line
(`console.error` for level `error`, `console.log` otherwise). This route predates the
/client-telemetry reference and keeps its own shape (see "Odd fields" below).

- **App (React Native):** `apps/mobile/services/client-log.ts` (buffer, batching, offline storage,
  redaction), wired in `services/runtime.ts`. Cast steps: `services/cast-trace.ts`. Uncaught errors:
  `services/js-errors.ts` (RN's `ErrorUtils` global handler, Hermes' unhandled-rejection tracker in
  release builds, and `components/ogs/AppErrorBoundary.tsx` around the root `Stack`). Device caps: 3
  of one error per launch, 20 errors a minute.
- **Cast receiver:** `apps/web/public/receiver.html` (`rxLog`), no credentials (marked
  `authenticated: false`, rate limited per IP). It logs its own failures; it does not yet capture
  uncaught `error` / `unhandledrejection` events.
- **TV launcher (`apps/tv`):** no client telemetry yet.

## Event names

| Event | Source | Level | Fields | Meaning |
|-------|--------|-------|--------|---------|
| `http.request` | server | info / error | `request_id` (cf-ray), `method`, `route` (pattern, never the path), `status`, `duration_ms`, `profile_id`, `device_kind`; stream routes add `trace_id`, `stream_steps` | One per HTTP request |
| `couch.action` | server (CouchSession DO) | info / error | `action` (message type, or `rejected` + `rejected: <code>`), `session_id`, `host_profile_id`, `device_id`, `device_kind`, `profile_id`, `sent`, `duration_ms` | One per couch session frame (hello, bye, focus, select, remote…) |
| `funnel.invite_sent` · `funnel.link_opened` · `funnel.testflight_tap` · `funnel.first_session` | server | info | `invite_id` (all four), `app_id`; `profile_id` (the inviter on invite_sent, the new host on first_session), `session_id` (first_session) | Invite another family (docs/acceptance/2026-10-18-invite-another-family.feature): filter `invite_id = <id>` for one invite's way in; counts also on `GET /api/v1/family-invites/:id` |
| `kind: "client_event"` (`name: cast.*`, `receiver.*`) | client | log / error | `name`, `level`, `attemptId`, `phoneAttemptId` (receiver only), `durationMs`, `error`, `errorType`, `data`, `source` (mobile/receiver), `profileId` (from the token), `build`, `version`, `platform`, `sessionId` (the couch session: the batch's, or the event's own), `deviceHash` | Cast lifecycle steps (docs/acceptance/2026-10-05-cast-logging.feature) |
| `name: app.js_error` | client (app) | error | `errorType`, `errorStack`, `data.fatal` | RN global handler caught an error |
| `name: app.unhandled_rejection` | client (app) | error | `errorType` (`UnhandledRejection` for a non-Error reason) | Unhandled promise rejection (release builds) |
| `name: app.render_error` | client (app) | error | `errorType`, `errorStack`, `data.boundary` | The root error boundary caught a render error |

### Client event fields

A batch is `{ context, events }` (`services/api/src/routes/client-events.ts`, parsed with Zod; 1–50
events, 64 KB). `context`: `app` (`mobile` | `receiver`), `build`, `version`, `platform`,
`profileId` (ignored: the token's wins), `sessionId`, `deviceHash`. Each event: `name`, `at`,
`level`, and optionally `attemptId`, `phoneAttemptId`, `sessionId` (ids, at most 64 characters),
`durationMs`, `error`, `errorType`, `errorStack`, `data` (flat scalars). An event's `sessionId`
wins over the batch's: the receiver's changes with each LOAD_VIEW.

### Reading a cast attempt end to end

One Cast tap is one phone `attemptId`; the TV's lines name it as `phoneAttemptId`. In Workers Logs,
filter `kind = client_event`, then:

1. **Phone**: `attemptId = <id>`. `cast.cast.requested` (`data.promptId` when the cast prompt asked),
   `cast.start.requested` (`sessionStatus`, `sdkSession`, `currentTv`, `targetTv` hashed, and
   `plan`: `start` | `already-connected` | `connecting` | `switch`), then one of
   `cast.start.skipped` (`reason`), `cast.connect.waited` (`outcome`), `cast.end.*` (a switch),
   `cast.start.resolved` (`started`; when false, `reason`: `refused-session-active` |
   `refused-no-session`) or `cast.start.rejected`. `cast.load_view.sent` (`reason`: `connect` |
   `request` | `change`) is the LOAD_VIEW that carried the id to the TV.
2. **The prompt**: `cast.prompt.shown` / `confirmed` / `dismissed` (`how`) share `data.promptId`
   (no attempt yet); `cast.prompt.error` (`reason`, `copyKey`: `no-answer` | `busy` |
   `user-message`) carries the attempt that failed.
3. **TV**: `phoneAttemptId = <id>` (or `sessionId = <couch session>`, which the phone's lines carry
   too): `receiver.load_view.received` once per distinct view, `receiver.load_view.ignored`
   (`why: duplicate`) for repeats, `receiver.stream.*`, `receiver.keepawake` /
   `receiver.visibility` (`streaming`). The receiver's own run id is its `attemptId`; from it,
   `receiver.launched` (`version`) and `receiver.sender` (`state`, `count`) show the lines before
   any LOAD_VIEW.

Older app builds send no ids in LOAD_VIEW: join those by `sessionId` or time.

## sre-agent

- Status: installed at **autonomy 0** (job summary only).
- Config: [.github/sre-agent.yml](../../.github/sre-agent.yml); workflow
  [.github/workflows/sre-agent.yml](../../.github/workflows/sre-agent.yml), runtime pinned to
  `jonmumm/skills/sre-agent/runtime@a948adacc8ae2d98cab7a142d1c90a0b83acc86b`.
- Sources: `opengame-api`.
- `errorFields` mapping: **none needed.** Server lines carry `error.type` / `error.message`.
  Client-event lines carry `error` as a string (the message) and `errorType` (the client's, else the
  event name for older builds and the receiver), both built-in sre-agent paths, so a client line is
  grouped as `TypeError: x is undefined` or `receiver.stream.failed: ICE failed`.
- Notification: at autonomy 1+ sre-agent emails Jon through the shared `sre-notify` Worker.
- Needs (owner): repo secret `SRE_CLOUDFLARE_API_TOKEN` (Account → Workers Observability: Edit) and
  repo variable `CLOUDFLARE_ACCOUNT_ID`. Kill switch: `gh variable set SRE_AGENT_ENABLED --body false`.

### Odd fields

- Client-event lines are logged as a JSON **string** (`console.error(JSON.stringify(line))`), not an
  object. sre-agent parses the raw line either way (checked against the pinned runtime's
  `identifyError`); whether Workers Logs indexes a JSON string's fields is unverified, so query
  them in the dashboard by `$metadata.message` if field filters come back empty.
- Their `error` is a string, not `{ type, message }`: the existing app builds, the receiver and the
  tests rely on it. `errorType` and `errorStack` sit beside it.
- Their top-level `message` (`client <app> <name>[: error]`) predates sre-agent; sre-agent reads
  `error` first.

## Native crashes (proposal, not built)

A crash in native code (Swift/ObjC/C++, an Expo module, Hermes itself) kills the process before JS
runs, so `js-errors.ts` never sees it. Today nothing reports them.

| | Apple MetricKit via a small Expo module | Sentry, crash-only |
|---|---|---|
| How | Subscribe to `MXMetricManager`; iOS delivers `MXCrashDiagnostic` for the previous crash on a later launch; the module hands it to JS, which posts it through `client-log` as `app.native_crash` (`errorType` = exception type or signal) | `@sentry/react-native` with native crash handler only: performance, replay, breadcrumbs and PII off |
| Pipeline | Same one: Workers Logs → sre-agent | A second dashboard and alert channel |
| Data | Stays in our Cloudflare account | Crash reports go to Sentry (a third party) |
| Symbolication | Ours: upload dSYMs from EAS builds and symbolicate offline (`atos`/`symbolicatecrash`); unsymbolicated frames until then | Handled (EAS dSYM upload plugin) |
| Latency | Next launch, sometimes up to a day (iOS batches diagnostics) | Next launch |
| Android | Nothing (would need `ApplicationExitInfo`) | Covered |
| Cost | No service; a small native module to own | Free tier likely enough; one more paid-tier account to watch |

**Recommendation:** MetricKit first, because it keeps one pipeline and kids' data in our account,
and the app is iOS-first and JS-heavy. `PreviousSessionCrashed` (an alive key the app clears on
background) is a cheap step before either: it says *that* a crash happened, on both platforms.
Revisit Sentry crash-only if native crashes become frequent and unsymbolicated frames slow fixes
down.

## Privacy

Kids use these apps. Never log display names, profile names, emails, tokens or anything a player
typed. Ids, counts, flags and enum values only. Backstops: `scrub` (server: emails, JWTs, `token=`,
bearer tokens in error text), `redact` and secret-named key drops (client and client-events route).
The CouchSession peer carries the profile's name and sticker; `couch.action` logs only ids.
