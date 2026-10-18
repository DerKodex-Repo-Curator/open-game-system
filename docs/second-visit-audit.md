# The second visit: audit (2026-10-18)

Goal: a household that played OGS once gets back into a round in under 10 seconds the next day.
Scenarios: [acceptance/2026-10-18-second-visit.feature](acceptance/2026-10-18-second-visit.feature).
Branch `claude/second-visit-0e55ec` (stacked on `claude/no-token-logs-0e55ec`); nothing deployed.

## What a returning household met (before this branch)

| # | Step | What happened | Cost |
|---|---|---|---|
| 1 | Open the app | Profile kept (Keychain), no onboarding; Library's hero is the last game played | none |
| 2 | Find the TV | Browser TVs kept on the phone and the TV page keeps its screen (same code), but the Cast button aimed at whichever TV was found first after a restart: the "just stopped" memory lived only for the app's run | a wrong TV in a house with a Chromecast and a laptop |
| 3 | Pick the game on the TV | A finished game leaves Continue after a day, a silent sitting after its TTL: yesterday's game was an icon in catalogue order; the ring started on the first icon | 2–4 remote presses, and a hunt |
| 4 | Same people again | No Play again or rematch: Start game on the game's page was the only way | a few presses |
| 5 | The browser guest rejoins | The join form was empty every time: name typed and sticker picked again | ~15 s, 4 taps |
| 6 | Last week's app players | No way to reach them: no list of past couch members, and the only push path is a game server's key | they never hear the couch is on |
| 7 | A late guest mid-game | The TV's join QR shows on Home and Getting ready only (funnel audit #13) | the guest waits for the next Home |

## Fixed on this branch (test-first)

| # | Fix | Where | Tests |
|---|---|---|---|
| 2 | The phone remembers the TV it cast to last, across launches; Cast picks it (after a TV picked or just stopped) | `apps/mobile/services/last-tv.ts`, `castTarget` | `last-tv.test.ts`, `play-action.test.ts` |
| 3, 4 | TV home: the game played last (any status, 30 days) is the first card, **Play again**, and first in the icon row after Continue/Tonight; the ring starts on it, so one OK starts a new game and the couch's phones follow (they already follow the TV) | `apps/tv/src/launcher/layout.ts`, `home.ts`, `ui/Home.tsx` | `home-again.test.ts` (11) |
| 5 | The join page remembers the guest on that browser: **Join as Grandma** in one tap, "Not Grandma?" for the form | `ogs-protocol` `rememberGuest`, `apps/web` `GuestForm` | `guest-memory.test.ts` |
| 6 | **Invite last week's players**: while the couch is on, the TV tab lists who shared a couch with the host in the last 7 days; Invite pushes the couch's join link. Only those people, only phones (never a tablet, so never a kid), once per person per couch; browser guests aren't listed (no push surface: they rejoin from the QR) | API `GET /api/v1/couch/recent-players`, `POST /api/v1/couch/invite`, table `couch_invites`; app `InviteRecent` | `couch-invite-routes.test.ts` (9), protocol, app |

**Decision for Jon:** the push spec says pushes are "not for … 'come back and play'". It was written
for game pushes; this is a person inviting people they played with this week, while their couch is
on. If that reads as "come back and play" to you, the API routes can stay and the sheet can share the
link instead of pushing.

## The second visit now (e2e, `e2e/second-visit-preview.ts`)

Dana's path, the next day: open OGS → TV tab → Cast (the TV is named, no code) → OK on the TV's Play
again → Ready. 4 taps. Grandma: scan the QR → Join from this browser → Join as Grandma.
Measured numbers: see "Measured" below.

## Not done (follow-ups)

- **#7, the join QR mid-game.** Starting from the phone's Library (Play → Cast) is 3 taps, but the
  game starts at once and the TV shows no QR, so a browser guest can't rejoin until Home. A corner QR
  during a game's lobby (the spec's `inviteCorner`) would make the 3-tap path work for everyone.
- **Chromecast's last TV** is remembered only through the same `lastTv` (its id), not a native
  "resume last session" on launch.
- **The API's clock** isn't moved in the e2e; its time rules (12 h sessions, the 7-day window) are
  unit-tested.

## Measured
