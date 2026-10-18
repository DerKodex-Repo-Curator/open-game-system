# Bug bash: Show HN dress rehearsal (Oct 18)

**Targets:** the three no-app previews: rocket-crew-try, trivia-jam-try and midnight-museum-try (`*.jonathanrmumm.workers.dev`).

**How it ran:**
- **Exploration:** `e2e explore` (tester-army, ChatGPT plan), 9 runs, 4 at a time, 10 steps each, with a laptop target (Chromium 1440×900) and an iPhone target (WebKit 390×844 with an iPhone user agent).
- **Deterministic probes:** Playwright tests for the WebSocket, stranger and leave charters.
- **Verification:** every fix test failed against the preview before its fix and passed after the redeploy.

## Charters

| # | HN visitor | How |
|---|---|---|
| 1 | Skeptical engineer at a laptop, no phone handy | explorer (laptop), all 3 games |
| 2 | Only a phone (reads HN there) | explorer (iPhone), all 3 |
| 3 | Opens a friend's room link in mobile Safari | explorer (iPhone), all 3 |
| 4 | Corporate network that blocks WebSockets | Playwright `routeWebSocket` closing every socket |
| 5 | A second visitor who joins a stranger's room code | Playwright, two browsers |
| 6 | Someone who leaves halfway | Playwright, closing a phone mid-game |

## Confirmed and fixed

| ID | Game | Finding | Sev | Repro test | Status |
|---|---|---|---|---|---|
| BB-01 | Rocket Crew | Laptop with no phone can't play (solo needed one phone for the Captain) | 4 | `e2e/hn-rehearsal.seam.test.ts` "a skeptic at a laptop…" | fixed, deployed |
| BB-02 | Rocket Crew | A network that blocks WebSockets: the TV and phones sit silent | 4 | "…blocks WebSockets…" | fixed (`/ws-probe` + `NetworkBanner`), deployed |
| BB-03 | Rocket Crew | A phone that leaves halfway: nobody is told, and the power keeps draining to a MAYDAY | 4 | "someone who leaves halfway…" | fixed (presence from the Room object, `AwayNote`, the clock waits), deployed |
| BB-04 | Rocket Crew | A stranger who typed the code can't be removed | 3 | "a stranger who types the room's code…" | fixed (`REMOVE` from the TV, can't sit again), deployed |
| BB-05 | Rocket Crew | A narrow phone browser that reports a mouse gets the TV page | 3 | "a phone browser that reports a mouse…" | fixed (`isControllerDevice`), deployed |
| BB-06 | Trivia Jam | Laptop with no phone: Start is disabled forever | 4 | `e2e/hn-rehearsal.spec.ts` "a skeptic at a laptop…" | fixed ("Play on this computer", `?play=1`), deployed |
| BB-07 | Trivia Jam | A network that blocks WebSockets: silent | 4 | "…blocks WebSockets…" | fixed (`/ws-probe` + `NetworkBanner`), deployed |
| BB-08 | Trivia Jam | A stranger can't be removed from the TV-hosted lobby | 3 | "a stranger who typed the code…" | fixed (Remove on the TV lobby). Rejoining is still allowed: the existing test "a removed player can join again" pins it |

## Confirmed, not fixed (handed to the museum-hillclimb session)

| ID | Game | Finding |
|---|---|---|
| BB-09 | Midnight Museum | A narrow phone browser that reports a mouse gets the TV page |
| BB-10 | Midnight Museum | A network that blocks WebSockets: silent |
| BB-11 | Midnight Museum | Laptop with no phone: no way to play (needs 2 detectives) |
| BB-12 | Midnight Museum | A stranger can't be removed |
| BB-13 | Midnight Museum | Leaving halfway: silent, and the turn can stall |

## Not a bug

- Trivia Jam, leaving halfway: the question still resolves on its timer (the test passes before and after).

## Rejected (harness artifacts)

- "Fixer Ready can't be activated" (Rocket Crew): the Ready button pulses forever, which trips the agent's wait for a stable element. Real taps work (the e2e tests and the iOS Simulator).
- "No rocket with that code" (Rocket Crew link run): my setup script never opened that room's TV.
- "Waiting for the host" (Trivia Jam link run): the room's TV was never running.

## Warnings and questions

- Phone-only visitors can't play any of the three. That's the format (a big screen is needed); each landing says so and offers to send the link.
- Midnight Museum's "How to play" closes only by tapping blank space.
- Rocket Crew's Lookout screen has no words (by design, for the family's toddler).
- Trivia Jam: should Remove be permanent? It needs a decision before changing an existing test.
