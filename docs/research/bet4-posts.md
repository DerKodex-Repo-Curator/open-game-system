# Bet 4 posts (drafts, not posted)

Bet: "Your web game on a real TV" for developers who build with coding agents
([next-week-bets.md §4](next-week-bets.md)). Metric, read **Mon 10-26**: at least 20 waitlist signups
**or** at least 2 outside developers with a game casting. Fail: fewer than 5 signups.

Every link carries its own UTM tags, so `pnpm --filter @open-game-system/docs waitlist:stats` shows
views and signups per post.

## Before posting (all must be true)

- [ ] `ogs-docs.pages.dev` production has the bet-4 build (`/on-tv`, `/starter`, `/pkg/*`,
      `/llms.txt`). Today only the previews do: https://bet4-landing.ogs-docs.pages.dev/on-tv.
- [ ] A playable Comet Catch demo is deployed (Worker in Jon's Cloudflare account), so the Phaser
      forum and HN Arcade have something to try with no signup: `/tv` on a laptop, phones by QR.
- [ ] The starter repo exists (`open-game-system/ogs-starter`, template repo), or the links below say
      `ogs-docs.pages.dev/starter` instead of GitHub.
- [ ] Jon has watched the 30 s video on `/on-tv` and is happy with it. It is Bake Shop's recorder
      output (TV page, grown-up phone, kid's iPad in sync), not a camera on a real TV. A 15 s phone
      video of a real Chromecast would be stronger; swap `apps/docs/landing/media/couch-demo.mp4`.
- [ ] Post as Jon, from Jon's accounts, with the disclosure line kept.

## 1. Phaser forum reply

Where: reply in [Are there solutions for playing games on another screen?](https://phaser.discourse.group/t/are-there-solutions-for-playing-games-on-another-screen/15407)
(2025 thread; the only answer so far is Playroom). Read the thread's last posts first; skip it if
someone has asked not to revive it. Link: `https://ogs-docs.pages.dev/on-tv?utm_source=phaser-forum&utm_medium=forum&utm_campaign=bet4`

> A late answer, in case it's useful to someone landing here: I've been building OGS, which does
> this for web games. The TV shows your game's TV page (cast from a phone app to a Chromecast, or any
> browser on the TV), and phones and iPads open your game's phone page as the controller. Players
> arrive with a name and avatar, so there's no name form, and the TV page gets a "pause" message when
> someone goes Home so it can stop the music.
>
> Your game stays a normal web game: it still runs in a plain browser with your own join codes, and
> inside OGS it gets a few postMessages and a small library. There's a starter (a small canvas game,
> no framework, with a TV page, a phone stick and a Cloudflare Worker room) and the docs are written so
> a coding agent can do the integration: "Make this game OGS-compatible: follow
> https://ogs-docs.pages.dev/llms.txt".
>
> It's early (the app is in a TestFlight beta), so I'm looking for a few web games to put on real
> TVs: https://ogs-docs.pages.dev/on-tv?utm_source=phaser-forum&utm_medium=forum&utm_campaign=bet4
>
> Playroom's Stream mode, mentioned above, is the other option if you want QR-join on a big screen
> without an app.

Notes: the forum is for Phaser users, so if Jon has time, port the starter's TV page to a Phaser
scene first and say so; that is a much stronger reply than "no framework".

## 2. HN Arcade

What it is: a directory and newsletter of Show HN games ("a handful of readers"; it featured Gaming
Couch). It lists games, so submit **the playable Comet Catch demo**, not the docs. Its submission
form's fields are **unverified**; fill what it asks with:

- **Title:** Comet Catch: a TV party game where phones are the controllers
- **URL:** `<demo>/tv?utm_source=hn-arcade&utm_medium=directory&utm_campaign=bet4` (the TV page links
  phones by QR; the game makes the room)
- **One line:** Open it on a laptop or TV, scan the QR code with phones, steer comets and catch
  stars. It's the open-source starter for OGS, which puts web games on a real TV.
- **Made with:** TypeScript, canvas, Cloudflare Workers + Durable Objects.

If HN Arcade only takes games that had a Show HN, hold this until bet 3's Show HN and submit both
together.

## 3. X

Post as a thread with the 30 s video attached to the first post (export a 1:1 or 16:9 MP4 from
`couch-demo.mp4`; X autoplays muted, so the first 3 s must show the TV and a phone moving together).
Link: `https://ogs-docs.pages.dev/on-tv?utm_source=x&utm_medium=social&utm_campaign=bet4`

> 1/ Your web game on a real TV, with phones as the controllers.
>
> I built OGS so my family's web games could play on our living-room TV. Now I want to see other
> people's games there. [video]

> 2/ If you build games with Claude Code, Codex or Cursor, the integration is one line:
>
> "Make this game OGS-compatible: follow ogs-docs.pages.dev/llms.txt"
>
> The docs tell the agent which steps your game needs, where the kits are, and which tests prove each
> step.

> 3/ What your game gets: the TV without a cast SDK, phones and iPads as controllers, players who
> arrive with a name and avatar (signed, so your server can trust them), and a pause signal when the
> couch goes Home. It still runs in a plain browser.

> 4/ It's early: the app is in TestFlight. I'm picking a few web games to put on real TVs next.
> Starter template + waitlist: https://ogs-docs.pages.dev/on-tv?utm_source=x&utm_medium=social&utm_campaign=bet4

Reply-guy follow-ups worth having ready: "How is this different from Playroom?" (a native app,
real Chromecast casting, push-link invites and household profiles; Playroom is QR-join in a
browser). "Does it work on Android?" (say what is true on the day: unverified today). "Lag?" (the
TV page runs on the Chromecast or TV browser; phones send input over the game's own WebSocket, so it
is the same latency as any web multiplayer game).

## Reddit (only after checking each sidebar)

r/gamedev, r/WebGames and r/playmygame self-promotion rules are **unverified** (Reddit could not be
fetched during research). Read each sidebar first; if a sub allows it, adapt post 1 and use
`utm_source=reddit-<sub>&utm_medium=forum&utm_campaign=bet4`.

## After posting

- Mon 10-26: `pnpm --filter @open-game-system/docs waitlist:stats` (views and signups per source),
  plus how many outside developers say their game casts.
- Reply to every signup that says what they're building within a day; the "2 developers casting"
  half of the metric needs hand-holding into the catalogue (a pull request today).
