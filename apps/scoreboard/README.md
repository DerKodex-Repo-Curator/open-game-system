# Bets scoreboard

One page that shows the five distribution bets (`docs/research/next-week-bets.md`) against their pass
and fail lines, from what OGS already records. Preview Worker `ogs-scoreboard` (workers.dev, behind
`SCOREBOARD_KEY`: open it once with `?key=`, then a cookie keeps you in). It changes no producer's
code or config and writes only its own Durable Object.

| Bet | Reads | How |
|---|---|---|
| 1 invites | `couch_sessions`, `family_invites` | opengame-api's D1, `SELECT` only (exact) |
| 2 clips, 3 HN, 5 co-op | front-door visits and taps by `utm_source` | ogs-front-door's `Tally` Durable Object, `summary()` over RPC, snapshotted every 15 min; a window = latest totals − the last snapshot before it (exact) |
| 3 HN | try-path link opens and rounds by `?ref=` | Workers Logs through the Analytics SQL binding (no token). This account's Workers Logs keeps a 1-in-10 sample, so these are estimates (≈) |
| 3 HN | points | Hacker News API, `HN_ITEM_ID` once posted |
| 4 devs | waitlist signups | ogs-docs-waitlist D1, `SELECT` only (exact) |

Every 15 minutes a cron gathers each bet window (bet 3 from Wed 10-21, the rest from Mon 10-19) and
stores it; the page renders the stored board. "Refresh now" re-reads. The **Sources** table shows each
source's last read (`ok` or its error); **Can't measure yet** lists what is missing.

```bash
pnpm --filter @open-game-system/scoreboard test       # synthetic events only, never production
pnpm --filter @open-game-system/scoreboard typecheck
cd apps/scoreboard && pnpm exec wrangler deploy        # the preview Worker
pnpm exec wrangler deploy --var HN_ITEM_ID:<id>         # once the Show HN post is up
```

Not measurable yet (also on the page): clip views (TikTok/Reels/Shorts analytics, by hand), TestFlight
joins (App Store Connect API), outside developers casting (no event), exact try-path counts (Workers
Logs is sampled; the Workers Observability API with a read token, or a counter per game), Trivia Jam
rounds by ref (its event has no ref), co-op households hosting at home (no co-op tag on profiles).
