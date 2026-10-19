# The ogs CLI is the developer tool, backed by a public developer API

Date: 2026-10-18 · Status: Accepted · Contract: [ogs-cli.md](../design-docs/ogs-cli.md)

## Context

Jon: make `ogs` the full OGS developer tool (init, dev, manifest check, publish, try, push send, plus the
white-label shell setup), backed by a public, documented API. Today a game reaches the catalogue by pull
request, the quickstart is a checklist an agent follows by hand, and testing needs a phone in the OGS app.

## Decision

1. **One identity:** the game's API key, as for sending pushes and setting up the white-label app.
2. **Publishing is a reviewed submission.** `PUT /apps/:appId/catalogue-entry` stores a pending entry;
   an admin (`OGS_ADMIN_TOKEN`) approves or rejects it; `GET /catalogue` serves the seed list plus live
   entries. The pull-request path still works for the seed.
3. **Validation is shared.** `ManifestSchema` (ogs-protocol) is the schema in the CLI and the API; the
   API adds the catalogue rules and live checks (reachable, frameable) a laptop can't be trusted with.
4. **`ogs dev` is local.** It signs its own fake game tokens and serves its own JWKS, so it works offline
   and never mints real OGS tokens.
5. **Try paths are the game's own deploy** (try-kit, the developer's Cloudflare account); OGS checks and
   records the URL so the catalogue can offer "Try it in your browser".
6. **Push testing uses the real send API** (no test-only send path), plus a read-only handle check.

## Consequences

- New tables `catalogue_entries`, `try_paths`; new secret `OGS_ADMIN_TOKEN`; `ManifestSchema` gains an
  optional `tryUrl`.
- The catalogue can change without a deploy once entries are approved; the seed stays in code.
