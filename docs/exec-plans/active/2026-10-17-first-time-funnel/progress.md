# First-time funnel: progress

Branch `claude/first-time-funnel-0e55ec`. Goal: a stranger household gets from zero to playing.
Audit and ranking: [docs/funnel-audit.md](../../../funnel-audit.md).

## Done

- 2026-10-17 `14e3d9a2` TV join card: QR to `opengame.org/join/<code>`, "Scan to join, or type", the
  code, "at opengame.org/join" (apps/tv/src/ui/JoinCode.tsx; ogs-protocol `join.ts`; e2e
  `apps/tv/e2e/join-qr.e2e.ts` decodes the QR off a screenshot).

- 2026-10-18 The invite link: `GET /api/v1/join/:code` (no token; names and stickers only),
  `opengame.org/join` and `/join/<code>` (apps/web `Join.tsx`), AASA `/join/*`; the app opens join
  links (`app/join/[code].tsx`) and holds any link that arrives before a profile until onboarding
  is done (`createLinkHold`, released by the tabs layout). Detox `e2e/first-time-funnel.test.ts`:
  host walk and guest-from-QR both green (before: the guest never reached the couch).
- docs/funnel-audit.md: measured walk and the ranked friction list.

## Decisions

- The launcher e2e's old copy assertion ("Join from your phone") follows the owner-approved join
  spec (2026-10-06): the spec changed first, so the test's expectation was out of date.
- `apps/tv/e2e/launcher.e2e.ts` "says Paused once" fails under very high machine load (load avg
  500+ from other sessions) and passes 3/3 when the load drops; not touched.

- The join page's logic lives in ogs-protocol (`join-page.ts`), not apps/web: apps/web is on Vite 5,
  which vitest 4 can't run on, and upgrading it would churn files the ogs-front-door session edits.
- `app-links-config.test.ts` expected exactly `/open`, `/open/*`, `/play/*`; it now also expects
  `/join/*`, which the approved join spec requires (an addition, nothing removed).
- Android's `/join/` intent filter is left for a native build (it would force every tester to update).
- Expo Router did not route the https join link at cold start (only `open()` saw it), so `open()`
  handles https join links and the join screen handles `opengame://join/…`; both hold until a profile.
- Detox walks get 300 s each: under the machine's load spikes the host walk passed 120 s.

## Next

See the ranked list in docs/funnel-audit.md. Next up: #2, browser TV (no Chromecast).
