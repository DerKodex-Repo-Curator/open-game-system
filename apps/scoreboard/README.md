# Bets scoreboard

One page that shows the five distribution bets (`docs/research/next-week-bets.md`) against their pass
and fail lines, from what OGS already records. Preview Worker `ogs-scoreboard` (workers.dev, behind
`SCOREBOARD_KEY`: open it once with `?key=`, then a cookie keeps you in). It changes no producer's
code or config and writes only its own Durable Object.

| Bet | Reads | How |
|---|---|---|
| 1 invites | `couch_sessions`, `family_invites` | opengame-api's D1, `SELECT` only (exact) |
| 2 clips, 3 HN, 5 co-op | front-door visits and taps by `utm_source` | ogs-front-door's `Tally` Durable Object, `summary()` over RPC, snapshotted every 15 min; a window = latest totals − the last snapshot before it (exact) |
| 3 HN | try-path link opens and rounds by `?ref=` | Rocket Crew, Trivia Jam, Peekaboo Garden, Night Flight: this Worker tails their try previews (`tail_consumers` in `[env.try]`) and writes one Analytics Engine data point per open and round (`ogs_try_events`, exact). Bake Shop, Story Nook, Midnight Museum: Workers Logs, sampled 1 in 10 (≈) |
| 2 clips | landings per clip | the tally's campaigns (utm_campaign = clip id); views typed in |
| 1, 5 | TestFlight joins | typed in from App Store Connect; `/get-app` (public) counts taps server-side, then redirects to `TESTFLIGHT_URL` (until set: the front door) |
| 4 devs | starter.tgz and kit downloads | the docs' Pages Functions on branch `claude/docs-download-count` (Analytics Engine; shown once `DOCS_DOWNLOADS_LIVE=1`) |
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

Not measurable yet (also on the page): outside developers casting (no event; downloads and signups are
the proxies), exact counts for Bake Shop, Story Nook and Midnight Museum (not tailed: other sessions own
them; one `tail_consumers` line each), Trivia Jam rounds by ref (its event has no ref), co-op households
hosting at home (no co-op tag on profiles). Clip views and TestFlight joins are typed in by hand.
