# progress: bet 3, the no-app try path (Show HN)

Updated 2026-10-18.

## Done
- Game: **Rocket Crew** (two-seat co-op; not catancast/bobberbrook). The browser path already existed (QR + name join, phone start chooser, laptop→Chromecast canvas cast). No monorepo protocol/bridge change was needed.
- Branch `try/show-hn` in `~/src/rocket-crew` (worktree `~/src/rocket-crew-try`), pushed. Commits: 899ce4f, 39bf619, a856b68, (phone hint), 84b41aa.
  - `?ref=` → room input → `rocket.round` wide events per launch/landing (Workers Logs).
  - Solo seat: "Only one phone? Be the Fixer on this computer".
  - Phone start page: "open <address> on a laptop".
  - `e2e/try-path.seam.test.ts` (4 tests), green locally and on the preview.
- Preview: https://rocket-crew-try.jonathanrmumm.workers.dev/?ref=hn (Worker `rocket-crew-try`, `pnpm deploy:try`). QR: docs/research/show-hn-try-qr.svg.
- Verified: real Safari 26 TV; iOS 26 Simulator Safari as Captain and as Fixer (2 problems fixed); press→TV 95–153 ms on the preview; `rocket.round` seen in `wrangler tail`.
- docs/research/show-hn.md: title, body, casting write-up, objection answers, pre-post checklist.

## Not done / open
- Real-device pass (iPhone, iPad, Chromecast) and a real shake: not run.
- Playwright WebKit can't load the TV page (WebGL lost); the e2e TV is Chrome only.
- Pre-existing on rocket-crew main: `pnpm typecheck` fails in scripts/showcase.mts + scripts/cast-device-check.mts; 3 stale tests in e2e/start.seam.test.ts.
- The Fixer's frog button has a face (Jon's "no faces on objects" rule); pre-existing art.
- Jon to decide: custom domain, the open-source answer, and whether to link the catalogue page.
