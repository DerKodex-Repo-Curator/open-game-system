# Show HN: bet 3, ready to post (not posted)

Bet 3 from [next-week-bets.md](https://github.com/open-game-system/open-game-system/blob/claude/distro-research-401b1b/docs/research/next-week-bets.md): post Wed 10-21 around 8am PT, read the result Fri 10-23. Pass: front page or 50+ points, and 100+ rounds played.

## The try path (live)

**https://rocket-crew-try.jonathanrmumm.workers.dev/?ref=hn** (QR: [show-hn-try-qr.svg](show-hn-try-qr.svg))

- **Game:** Rocket Crew, a two-seat co-op talking game like Spaceteam. The Captain's phone shows a problem in words. The Fixer's phone shows only pictures of the controls. The 3D rocket is on the TV. It is the OGS game built for exactly two players, and the most polished one (31 critic rounds).
- **A laptop opens the link** and becomes the TV: a new room, a QR code and a 4-letter code. **Phones scan the QR in the camera app** and open in the browser. They type a name and play. No app, no account, no install.
- **Alone with one phone:** once the Captain's phone is aboard, the TV offers "Only one phone? Be the Fixer on this computer". That opens the Fixer's panel in a window on the laptop. Gaming Couch found that people try alone before they bring a group.
- **Opened on a phone** (most HN reading happens there): the start page says to open the address on a laptop, and still offers Join by code.
- **Cast to a real TV:** in desktop Chrome, "Cast to TV" sends the game to a Chromecast. The laptop streams its own 3D canvas, with no app here either.
- **Counting:** each launch and landing writes one `rocket.round` wide event to Workers Logs with the `ref`, so rounds from HN are a log query: `event = "rocket.round" AND phase = "launched" AND ref = "hn"`. The log has no names and no IP addresses.

Code: branch `try/show-hn` in `~/src/rocket-crew` (worktree `~/src/rocket-crew-try`). It runs as its own Worker (`rocket-crew-try`, `pnpm deploy:try`), so production `rocket-crew` is untouched.

### What was tested

| Check | Result |
|---|---|
| Unit tests (`pnpm test`) | 1014 pass, incl. new: ref parsing, the round wide events, the solo-seat rule |
| `e2e/try-path.seam.test.ts` against the **deployed preview** | 4/4 pass: Chrome laptop TV with two iPhone (WebKit) browsers flying a problem; the solo seat; the phone start page; press-to-TV latency |
| Press on a phone → TV shows it | **120 ms** on localhost; **95–153 ms** over the internet to the preview across runs (Chrome TV, WebKit phone, same machine) |
| Real Safari 26 (macOS) as the TV | Renders the lobby, the 3D rocket and the QR. A Captain from iOS Simulator Safari showed up on it |
| iOS Simulator Safari (iOS 26) as the Fixer | Joined by the room link, got the motion permission prompt, launched, and fixed two problems by tapping. Chrome was the TV and the Captain |
| Wide events on the preview | `wrangler tail` showed `{"event":"rocket.round","phase":"launched","ref":"hn",…}` |

**Not covered:** Playwright's WebKit build never finishes loading the TV page (its WebGL context is lost and the main thread stalls), so the e2e TV is Chrome only and Safari-as-TV was checked by hand. Shaking was not tested on a real iPhone (the simulator can't shake). Nothing was tried on a real iPad, phone or Chromecast in this pass. Firefox was not tested.

## Title

> Show HN: Rocket Crew – a co-op game where your phones are the controllers, no app

Alternates:
- Show HN: Cast a web game to your TV; phones join by QR code, no app
- Show HN: Open Game System – web games on the TV, phones as controllers

Lead with the thing people can try right now. Put the platform in the body. HN's Show rules want something to try without sign-ups, and a platform pitch reads like a landing page.

## Post body

> Open this on a laptop and scan the QR code with your phone: https://rocket-crew-try.jonathanrmumm.workers.dev/?ref=hn
>
> Rocket Crew is a two-player co-op game in the style of Spaceteam. One phone (the Captain) reads out what's broken: "Shield trouble! Press the star button!" The other phone (the Fixer) only has the controls, with no words. The rocket flies on the big screen. A mission takes about five minutes. Playing alone? Once your phone is the Captain, click "Be the Fixer on this computer".
>
> There's no app, no account and no install. The laptop is the TV and the phones are browser tabs. If you have a Chromecast, "Cast to TV" in Chrome sends it to the real TV. The laptop streams its own WebGL canvas to the Chromecast over WebRTC, and the Chromecast draws the HUD on top.
>
> I built it for my family: my 5-year-old is the Fixer and I'm the Captain. It's one of about fifteen games on a small platform I'm building, Open Game System (OGS). OGS puts web games on the TV, with phones as the controllers, profiles for everyone on the couch, and push links to invite another household. The full version is a native iOS app (TestFlight) that casts any OGS game to a Chromecast. This post is the browser-only slice, so you can try it in 30 seconds.
>
> How it works: each room is a Cloudflare Durable Object running an XState machine (actor-kit). Every phone and the TV hold a WebSocket to it, and each one gets only its own view of the state. The Fixer never receives the Captain's text, so you have to talk. A tap on a phone shows on the TV in about 150 ms. Details in the comments.
>
> I'd love to hear where it breaks: your phone, your browser, and whether the QR join worked first try.

(About 290 words. The engineering write-up goes in the first comment, below.)

## First comment: how casting works

> Some engineering detail for anyone curious:
>
> **One room = one Durable Object.** The TV page creates the room (a random 4-letter code) and the phones join `/join/CODE`. The DO runs an XState v5 machine through actor-kit. After every event it rebuilds each caller's private view, and a socket only ever receives `public + its own slot`. That's how the Captain and the Fixer see different screens of the same game without trusting the client. A refreshed phone keeps its seat: its caller id is a token in the URL plus a cookie.
>
> **Latency.** A tap goes phone → WebSocket → DO → WebSocket → TV. Measured in Playwright against the deployed Worker, it's about 150 ms from tap to the TV's DOM changing (Chrome TV, WebKit phone, the same machine, so one network path). Nothing is predicted client-side. For a talk-and-press game, round-trip latency under a few hundred ms is fine. A twitch game would need more.
>
> **Getting to a real TV, two ways:**
> 1. *From a laptop (this demo):* Chrome's Cast SDK opens our custom receiver on the Chromecast. The laptop renders the 3D scene anyway, so it streams its canvas (`captureStream()`, paced to 30 fps, VideoToolbox encode on a Mac) straight to the Chromecast over WebRTC. The Chromecast loads the game's page in "HUD mode" and draws the 2D overlay on top of the video. No cloud GPU, no screen-share prompt. We hold 720p at 4 Mbps. Raising the bitrate made the Chromecast HD's decoder stall more, so the TV, not the network, is the limit.
> 2. *From a phone (the OGS app):* a phone can't render a 3D TV scene and its own controller at the same time. So the app asks our API to start a headless Chrome on a GPU (Cloud Run, one L4, scales to zero). That Chrome loads the TV page and publishes it over WebRTC through Cloudflare's Realtime SFU to the Chromecast. The TV page reports player activity, and an idle stream shuts itself down so a forgotten cast doesn't keep a GPU running.
>
> **The game doesn't care which one happened.** The TV page is an ordinary web page that's either open in a tab, framed by the OGS TV launcher, or rendered in the cloud. Inside the OGS app, players come from the couch (OGS profiles, verified with a signed game token) instead of a QR code. In a plain browser you type a name. That fallback is what you're playing now.

## Prepared answers to likely objections

**"iOS Safari runs out of memory / crashes on these."** (This came up in the Gaming Couch thread.) The phones never render the game. Only the TV does. A phone page is a React controller with a few small canvases for the control icons. In Chrome's iPhone emulation it uses about 24 MB of JS heap, and the TV page about 82 MB. The 3D scene runs only on the laptop or in the cloud, never on the phone. I haven't measured on a real iPhone yet, so if it crashes yours, please tell me the model.

**"What about lag?"** About 150 ms from a phone tap to the TV, measured against the live Worker. Rooms are Durable Objects, which run near whoever created the room, so a couch in one place gets one short path. It's a talking game, so a press has a whole sentence of slack. Casting from the laptop adds the Chromecast's video latency (roughly a few hundred ms more; not measured precisely). That's why the phones never wait on the video: they talk to the room, not the TV.

**"Why not just use AirConsole (or Jackbox, or Playroom)?"** AirConsole is a store and a car platform now (VW is shipping it in 2027 models). You port your game to their SDK and their catalogue. Jackbox is a closed set of games. Playroom Kit's stream mode is the closest thing: a big screen plus phones by QR. OGS differs in what happens after the browser: a native app that casts to a real Chromecast (cloud-rendered when the phone can't), profiles for the people on the couch so you never type a name or code again, and push links to pull another household into a game. The games are plain web pages with a small contract (OGS docs: https://ogs-docs.pages.dev), so they also run fine in a browser like this one.

**"What data do you collect?" / privacy.** No account and no sign-up. The name you type is stored in that room's Durable Object for the room's lifetime and shown on the TV and the other phones. It's never logged. Our logs get one line per launch and per landing: room code, where the link came from (`ref=hn`), the player count and the stars. No names or IPs in those events (Cloudflare's own request logs keep the usual request metadata), no third-party analytics or ads, no cookies beyond one that lets your phone rejoin its seat in that room. The crew's progress (rank, stickers) lives in the TV browser's localStorage. (Check this before posting: confirm the Google Fonts load on the TV page is acceptable, or self-host the font.)

**"Why do I need a laptop? Just make it work on the phone."** The whole point is a shared screen people look at together, with private screens in their hands. On a phone alone, "Use this screen as the TV" is on the start page, but it's not the game.

**"It's a kids' game."** Yes. I made it for my son, and grown-ups play it too. The labels say "Grown-up" and "Kid" because that's my house. The game is the same for two adults, and the seats can be swapped. Other OGS games (a trivia game, a Codenames-like) are for adults, but they need more players, so I picked this one for a two-person try.

**"Is it open source? Can I put my game on it?"** (Fill in Jon's answer: which repos are public and whether the SDK is open to outside developers. Bet 4 is the developer path, with docs at https://ogs-docs.pages.dev and `/llms.txt`.)

**"Does it work on Firefox / Android?"** It works on Chrome and WebKit (tested). Firefox and real Android phones are **untested**. The Chromecast cast button only shows in desktop Chrome.

## Before posting (checklist for Jon)

1. **Pick the URL.** The workers.dev address is long and shows on the phone start page. Consider a custom domain (e.g. `rocketcrew.<your domain>`) on the `rocket-crew-try` Worker. The `?ref=hn` link keeps working either way.
2. **Play one full mission on the real devices:** a laptop as the TV, your iPhone as the Captain and a second phone as the Fixer, plus one solo run. Shaking (the "everybody shake it off" problems) was not tested on a real phone. Over HTTPS, iOS asks for motion permission when you tap Ready.
3. Fill in the open-source answer above.
4. Decide whether the post links the catalogue page (front-door) too. Bet 3's metric counts catalogue visits, and the post above links only the game and the docs.
5. Watch the logs while it's up: `pnpm wrangler tail --env try` in `~/src/rocket-crew-try`, or the Workers Logs query above.
6. Cost: a Worker and Durable Objects on the existing paid plan. Nothing is always-on, and the laptop cast uses no cloud GPU. The cloud GPU only runs when someone casts from the OGS app.
