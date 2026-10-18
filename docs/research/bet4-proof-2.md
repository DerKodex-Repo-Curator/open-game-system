# Bet 4 proof, round 2: Paddle Pop (Phaser 3)

Same setup as round 1 (fresh subagent, the one-line prompt, docs site only), on the docs with round 1 fixed, and a Phaser 3 two-paddle game on one keyboard. Result: steps 0-11 done, the original page kept as the plain-browser game, `/tv` + `/phone` added, a computer plays an empty side; 38 unit + 12 seam tests passing (agent-reported; its commits are 5ee5376, 0687b25). Not verifiable there: the catalogue PR, the real app, a real TV, canvas text inside the safe area (by eye only).

**Incident:** while rendering art it started `wrangler dev` on fixed port 8791, which a rocket-crew preview (`.claude/worktrees/campaign`) already used, and its cleanup `pkill -f "port 8791"` killed that server. The testing page now says to use free ports and never kill by port.

Its friction log, verbatim:

## Blocking or wrong

1. **The starter's test setup hangs `pnpm test` with the versions the quickstart installs.**
   https://bet4.ogs-docs.pages.dev/quickstart.md step 0 says `pnpm add -D wrangler @cloudflare/workers-types vitest playwright`,
   which today installs vitest 5.0.5. The starter (`starter.tgz`, `vitest.config.ts`) puts unit and seam
   tests in one config as two `projects`, and its `pnpm test` is `vitest run --project unit`. Under
   vitest 5 the seam project's `globalSetup` (which spawns `wrangler dev` and waits up to 90 s) still
   runs for `--project unit`: my first `pnpm test` sat silent until my 60 s timeout killed it.
   The starter pins vitest ^4, the quickstart does not. **Did:** two configs,
   `vitest.config.ts` (unit) and `vitest.seam.config.ts` (seam, with the globalSetup).

2. **Phaser owns an AudioContext and wakes it on its own, so the documented pause gate didn't hold.**
   https://bet4.ogs-docs.pages.dev/starter.md says "no framework, so the same wiring drops into Phaser";
   quickstart step 3 says "suspend your AudioContext". With `createAudioPause(() => phaserSoundManager.context)`
   the pause seam test (testing.md §1) failed: the context was still `running` after `ogs:suspend`.
   Phaser 3.90's `WebAudioSoundManager` resumes its context on window focus (`onFocus`, unless
   `pauseOnBlur` is off) and unconditionally ~100 ms after every visibility change (`onGameVisible`),
   and its unlock handler resumes on any tap/key. I did not pin down which one fired in the test.
   **Did:** Phaser's sound off (`audio: { noAudio: true }`), the page owns one `AudioContext`
   (`src/game/audio.ts`) that the gate suspends; the test now passes. A "Phaser / Three.js / Pixi notes"
   section would have saved this; Phaser is the engine the quickstart's table names first.

3. **Where does the phone page live when the existing page stays the plain-browser game?**
   quickstart step 0: "Keep your page as it is (it is the plain-browser version) and add two pages:
   a TV page (`/tv`) … and a phone page (the controller; this is the manifest's `startUrl`)". It names
   no path for the phone page, and the starter it says to copy uses `index.html` as the phone page, so
   its `vite.config.ts` (listed in the copy table) and the TV's join QR (`/?room=CODE` in
   `src/tv/main.ts`) both assume `/` is the phone. Copying them as written would have replaced the
   game's own page. **Did:** `/` stays the keyboard game, the controller is `phone.html` (`/phone`),
   the QR points at `/phone?room=CODE`, `startUrl` ends in `/phone`.

4. **I killed another project's dev server because of a fixed port.** Not a docs bug, but the docs
   half-warn about it: testing.md says "pick free ports", yet its own snippets use fixed ones
   (`http://localhost:8787`, `http://localhost:8831/.well-known/jwks.json`) and the starter README says
   `pnpm dev` on 8787. I started `wrangler dev --port 8791` by hand to screenshot the TV for `art/tv.jpg`;
   8791 was already taken by another local wrangler, my readiness check got answered by that server,
   and my cleanup `pkill -f "port 8791"` then killed that other server (a wrangler dev on 0.0.0.0:8791
   from another checkout on this machine). **Did:** the art script now finds a free port, starts its
   own wrangler, checks the answer is Paddle Pop, and kills only its own process group. The testing
   page's snippets should use the free-port pattern they recommend.

## Missing steps or unclear

5. **Step 0's copy list is incomplete.** quickstart step 0 lists the Worker, `protocol.ts`,
   `room-core.ts`, `socket.ts`, `wrangler.jsonc`, `vite.config.ts`. I also needed from the starter:
   `src/client/ogs-plan.ts` (the TV join-UI and phone-plan decisions the later steps rely on),
   `src/tv/audio-pause.ts` (step 3 prints it inline), `src/client/config.ts`, `e2e/keys.ts` and
   `e2e/global-setup.ts` (step 6/11 tests), and `@types/node` (the starter's tsconfig has
   `types: ["node"]`; not in the quickstart's `pnpm add` lines). `room-core.ts` imports `Seat` from
   `sim.ts`, and that `Seat` carries a `color` my game doesn't use. **Did:** copied and adapted them.

6. **The safe-area check in the testing page doesn't fit a canvas engine.**
   https://bet4.ogs-docs.pages.dev/testing.md §1 "Test at TV sizes": the helper skips only `<canvas>`, so
   Phaser's full-bleed parent `<div id="game">` is reported as outside the safe area; and it can't see
   anything drawn on the canvas (Paddle Pop's score, names and paddles are all canvas). **Did:** the
   helper also skips `#game`; the scene zooms the camera to 0.9 on the TV page so the whole 960×540
   field sits inside the 5% inset (checked by eye on screenshots at 1280×720 and 1920×1080, not by a test).

7. **"Nothing over the focal area" for a game whose whole screen is focal.** rules.md §3 says HUD at the
   edges. In Pong the ball uses the full field, so any text over the field is over the focal area.
   **Did (guess):** the only DOM text on the OGS TV is one line at the bottom-left edge that shows only
   while nobody holds a paddle; the plain-browser join card is a small bottom-right corner card. Rules
   §2's planned invite corner (top-right, 220×120 on 960×540) overlaps the right player's name. I left it.

8. **One-screen game: what happens to a side no phone holds, and who plays when?** quickstart step 0
   says "One player becomes one per phone … plus what happens when phones join and leave", which is the
   right question but has no example for a fixed two-player game. **Did:** first seat holds the left
   paddle, second the right, more phones wait their turn (`sidesFor`), and an empty side is a beatable
   computer paddle, so one phone can play and the TV plays itself before anyone joins.

9. **Roles for a symmetric game.** quickstart step 10: "the catalogue wants at least one role a kid can
   play". messages.md says roles are "who sits where" and `ogs:start.roster` maps profiles to `roleId`s,
   but no page says what a game should do with the roster, or how to model "two identical players".
   **Did:** two roles (`player`/kid and `grownup`/grownup, both labelled "Player"), roster ignored.
   Players are seated in the order their phones join.

10. **Static `tvUrl` or room game?** messages.md: "A game with one TV page for everyone adds `tvUrl`";
    quickstart step 8: "Skip this if your manifest has a static `tvUrl`". Paddle Pop's TV page could make
    its own room under a static `/tv`, but no page says whether the host phone then gets `ogsRoom` (the
    contract §3 says followers wait for `ogs:room`, and "the phone that starts a game hosts it (its start
    page makes the room)"). **Did:** followed the starter: no `tvUrl`, the host phone makes the room and
    declares `/tv?room=CODE` with cast-kit-core's `SET_VIEW_URL`.

11. **The starter points at a different docs site.** The starter's README, AGENTS.md and
    `scripts/update-kits.mjs` use `https://ogs-docs.pages.dev`, not `bet4.ogs-docs.pages.dev`, and the
    `profile-kit.tgz` inside `starter.tgz` is not byte-identical to `bet4…/pkg/profile-kit.tgz`
    (cast-kit-core is). **Did:** used bet4's tarballs everywhere; did not copy `update-kits.mjs`.

12. **Small snippet gaps.** quickstart step 3: `onOgsPause((paused) => audio.setPaused(paused))` uses an
    `audio` that isn't defined until the `createAudioPause` block further down. Step 3 also says resume the
    `AudioContext` on first `pointerdown` in a plain browser; nothing warns that this unlock must not run
    while parked (I made it check). Step 5's React snippet comes first though step 0 sends a canvas game
    down the no-React path.

13. **The production JWKS URL is a personal workers.dev host.** contract §4 / profile-kit.md: always pass
    `jwksUrl`, production is `https://opengame-api.jonathanrmumm.workers.dev/.well-known/jwks.json` because
    `api.opengame.org` has no DNS. As an outside developer I'd hesitate to ship that. **Did:** put it in
    `wrangler.jsonc` `OGS_JWKS_URL` as told; seam tests override it with a local key set.

14. **The art kit has no tooling or template.** art-and-catalogue.md gives sizes and rules but nothing
    to make them with. **Did:** `scripts/make-art.mjs` renders all five images from HTML/CSS with Playwright
    in the game's palette (no paid services), `tv.jpg` from the real TV page after an `ogs:start`.

15. **Catalogue submission is a PR to someone else's monorepo.** art-and-catalogue.md "Submit": edit
    `services/api/test/catalogue.test.ts` and `services/api/src/catalogue.ts`, copy art to
    `apps/tv/public/art/<appId>/`, run that repo's gates. The contract page also leans on monorepo paths
    (`apps/tv/src/launcher/frames.ts`, Rocket Crew's `wrangler.toml`) an outside developer can't see from the
    docs. **Did:** not done (this run doesn't push or open PRs); the manifest is checked locally against
    `ManifestSchema` from the vendored `ogs-protocol.tgz`.

16. **The TV page and couch names.** quickstart step 3 "Done when … the TV names the players from
    `ogs:start`". For a phone-controller game the names that matter are the seated phones (from verified
    tokens), not the couch list. **Did:** the TV labels each paddle with its seat's name, and shows the
    couch names from `ogs:start` only in the "pick up a phone to play" line.

## Not the docs: the game itself

17. **The original game threw on the first paddle hit.** `this.sound.play?.("")` throws
    `Audio key "" not found in cache` in Phaser 3.90 (reproduced in Chromium on commit b9a635a with the
    Down arrow held so the right paddle meets the first serve). Phaser calls the step before scheduling
    the next frame, so I expect the game to stop there; I saw the error, not the freeze. **Did:** replaced it
    with a synthesized blip; a plain-browser seam test now holds Down through that hit and expects no page errors.

## What changed in response

| # | Fix |
|---|---|
| 1 | Starter splits unit and seam configs (`vitest.seam.config.ts`), so `pnpm test` never starts wrangler; docs pin `vitest@^4` |
| 2 | Step 3: Phaser resumes its own AudioContext; use `noAudio` and one page-owned context (what passed the seam test) |
| 3 | Step 0: phone page is `/phone` when the original page stays; how to adapt the starter's vite config and QR |
| 4 | Testing: free ports in every snippet, never kill a server by port |
| 5 | Step 0 copy table lists `ogs-plan`, `audio-pause`, `config`, the e2e setup, `@types/node` |
| 6 | Safe-area helper skips the engine container; canvas text needs an inset or camera zoom |
| 8 | Step 0: fixed sides, waiting phones, a computer for an empty side |
| 10 | Step 8: a game with rooms omits `tvUrl` and the host phone declares the TV page |
| 12 | Step 3 snippet defines the gate before using it; the unlock must not resume while parked |
| 7, 9, 16 | Not changed: judgment calls the agent made sensibly (roles for symmetric games, couch names vs seats) |
| 11 | Expected on a preview: the starter names production; the kit contents are equal (a test checks) |
| 13 | For Jon: the production JWKS host is a personal workers.dev name |
| 14, 15 | For Jon: no art tooling for outside devs; catalogue entry is a PR into the monorepo |
