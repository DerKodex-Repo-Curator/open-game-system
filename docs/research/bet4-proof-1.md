# Bet 4 proof, round 1: Rock Dodge (vanilla canvas)

A fresh subagent got only the one-line prompt ("Make this game OGS-compatible: follow https://bet4.ogs-docs.pages.dev/llms.txt") and a one-screen keyboard canvas game with no OGS code, and was told to use nothing but the docs site. Result: steps 0-11 done, 36 unit + 17 seam tests passing (re-run by the coordinator: typecheck clean, 36/36, 17/17). Not verifiable there: the catalogue PR, the real app, a real TV.

Its friction log follows verbatim. What changed in response is in commit f14f7551 (and 0f7d3771-era starter fixes); the table at the end maps each item.

# FRICTION: making Rock Dodge OGS-compatible from the docs alone

Source of truth used: only pages under https://bet4.ogs-docs.pages.dev/ (llms.txt, llms-full.txt,
quickstart, starter.tgz, the two kit tarballs). Each entry: where, what was unclear/wrong/missing,
and what I did.

## Setup and install

1. **Two doc hosts.** https://bet4.ogs-docs.pages.dev/starter.tgz -> `ogs-starter/README.md`,
   `AGENTS.md` and `scripts/update-kits.mjs` all point at `https://ogs-docs.pages.dev` (no `bet4.`).
   It is not said which host is canonical, and `pnpm kits:update` in the starter would fetch kits from
   the other host. I used only bet4 URLs and pointed my own kit-update notes at bet4.
2. **The starter's vendored profile-kit is not the one the site serves.**
   `ogs-starter/vendor/open-game-system-profile-kit-0.1.0.tgz` (sha1 d5f00caa...) differs from
   https://bet4.ogs-docs.pages.dev/pkg/profile-kit.tgz (sha1 d6010509...), both claim version
   `0.1.0`. cast-kit-core matches. No changelog, so I can't tell what changed. I used the site's
   tarball (the quickstart says to).
3. **Vendor file names differ** between https://bet4.ogs-docs.pages.dev/quickstart.md#1-install-profile-kit
   (`vendor/profile-kit.tgz`) and the starter (`vendor/open-game-system-profile-kit-0.1.0.tgz`).
   Harmless, but a reader comparing the two wonders which is expected. I followed the quickstart.
4. **pnpm 10 blocks the build scripts wrangler needs.** Step 0 says "copy the starter's room Worker"
   but lists no dependencies. Copying it means adding `wrangler`, `@cloudflare/workers-types`,
   `vitest`, `playwright`, `qrcode-generator`, and allowing `esbuild` + `workerd` build scripts. With
   pnpm 10.28 `pnpm add` printed "Ignored build scripts: esbuild, workerd" and wrangler would not run.
   The starter pins `packageManager: pnpm@9.15.9` and uses `pnpm.onlyBuiltDependencies` in
   package.json; I put `onlyBuiltDependencies` in `pnpm-workspace.yaml` instead (pnpm 10 style).
5. **Copying "the starter's room Worker" drags in more than the Worker.**
   https://bet4.ogs-docs.pages.dev/quickstart.md#0-no-server-yet-add-one-for-phone-controllers names
   `src/worker/`, `src/shared/protocol.ts` and `src/client/socket.ts`, but `room.ts` also imports
   `src/shared/room-core.ts` and the `Seat` type from `src/shared/sim.ts`, the Worker serves the pages
   from `dist/` (so `wrangler.jsonc`, a multi-page `vite.config.ts` and a separate
   `src/worker/tsconfig.json` are needed too), and the starter's `.gitignore` entry for `.wrangler/`
   is not mentioned (I committed wrangler's local state once by accident and amended it out). I copied
   room-core.ts, socket.ts, worker/index.ts and worker/room.ts unchanged and wrote the rest.

## Shape of the game

6. **"Reads the sticks instead of the keyboard" vs "plays exactly as before outside OGS".** Step 0
   says the game loop moves to the TV page and reads phone sticks instead of the keyboard; the
   "Before you start" section says that after every step "the game must still play exactly as before
   outside OGS". For a one-screen keyboard game these conflict, and nothing says what happens to the
   existing page. I kept `/` (the original game, files untouched) and added `/tv` (TV page) and `/play`
   (phone controller, the `startUrl`). An outside developer could equally have turned `/` into the TV
   page; the docs should say which.
7. **Single-player game made multi-player.** The checklist assumes the TV game has seats. Rock Dodge
   had one ship; I made it one ship per seated phone (pure, seeded `src/shared/sim.ts`). Nothing in the
   docs talks about this redesign, which was most of the work.
8. **Sitting label for a game with no rounds or levels.** https://bet4.ogs-docs.pages.dev/quickstart.md#7-report-the-sittings-label
   shows `title: "Mission 6"`; the starter reports `Round N`. Rock Dodge has neither. I used
   `title: "Room CODE"` (the messages page's own example) and `detail: "Best: NAME N"`, re-reported
   only when it changes (a crash). The docs don't say how often reporting is fine, or whether `detail`
   is shown anywhere.
9. **Freeze or just mute while parked?** https://bet4.ogs-docs.pages.dev/rules.md#5-silent-while-parked
   says go silent and keep state. For a real-time dodge game, rocks would keep falling and crashing
   ships in a hidden frame. I also freeze the simulation while parked (as the starter does with its
   `parked` flag, which the docs never mention). A seam test checks the world doesn't change while
   parked and carries on after `ogs:resume`.
10. **Autoplay in a plain browser.** Step 2 / rule 6 say "start audio on load, no tap". That only works
    in the launcher's frame (`allow="autoplay"`); in a plain browser the `AudioContext` starts
    suspended. The starter quietly unlocks it on the first `pointerdown`/`keydown`; the docs don't say
    to. I copied the starter.

## Contract and reference

11. **Pointers to the author's machine.** https://bet4.ogs-docs.pages.dev/contract.md section 2 says
    "Pattern: `createAudioPause` in `~/src/night-flight-owls/src/client/audio-pause.ts`" and section 6
    lists `~/src/night-flight-owls/e2e/...` and `~/src/rocket-crew/e2e/...`. Those are local paths an
    outside developer can't open. (The quickstart inlines `createAudioPause`, so I used that.)
12. **`ogs:room` is for "multiCouch games" or for every room game?**
    https://bet4.ogs-docs.pages.dev/messages.md#ogsroom says "The room the TV page shows (multiCouch
    games)"; https://bet4.ogs-docs.pages.dev/contract.md section 2 and quickstart step 9 say every
    room-based game sends it (phones follow). I followed the contract (it says it wins) and send it.
13. **Two label messages.** messages.md lists both `ogs:resume-point { label }` ("older form") and
    `ogs:instance { report }`; contract section 2 lists both without saying which to use. profile-kit
    sends `ogs:instance`, so I used that.
14. **Which JWKS URL is production?** contract section 4 and the profile-kit reference say the default
    is `https://api.opengame.org/.well-known/jwks.json` "a custom domain not yet confirmed"; the
    quickstart (step 6) says it "does not resolve yet" and to use
    `https://opengame-api.jonathanrmumm.workers.dev/.well-known/jwks.json`, which looks like a personal
    workers.dev subdomain. I set that in `wrangler.jsonc` as `OGS_JWKS_URL` and did not fetch it
    (outside the allowed docs host), so whether it serves keys is **unverified**.
15. **cast-kit-core has no reference page.** profile-kit has https://bet4.ogs-docs.pages.dev/profile-kit.md;
    cast-kit-core (needed for step 8) has none (`/cast-kit.md` is a "Not found" page). What
    `isOGSCastAvailable()` means (I read `dist/index.mjs`: it is `getCastBridge()?.isSupported()`, i.e.
    "some React Native WebView bridge is present") and the `cast` store's state shape are only in the
    starter's code and tests.
16. **The fake WebView in the testing page is not enough for a room game.**
    https://bet4.ogs-docs.pages.dev/testing.md#2-the-phone-page-in-a-fake-webview gives the fake only a
    `profile` store (and mentions `ogs`). A hosting phone also needs a `cast` store, or
    `SET_VIEW_URL` is never dispatched and the "declares its TV page" assertion can't pass. Its state
    shape (`isAvailable, devices, session{...}, error, viewUrl`) is documented nowhere; I copied it from
    the starter's `e2e/phone-webview.seam.test.ts`.
17. **The manifest has no schema a game can import.** messages.md says the tables are generated from
    `ManifestSchema` in `packages/ogs-protocol`, but ogs-protocol isn't served under `/pkg/`
    (`/pkg/ogs-protocol.tgz` is 404) and profile-kit doesn't export it. I hand-wrote a zod schema from
    the field table in `src/client/config.test.ts`; it can drift from the real one.
18. **`roles` is optional in the schema but required in practice.** messages.md: `roles` "no (default
    `[]`)". https://bet4.ogs-docs.pages.dev/art-and-catalogue.md#submit-to-the-catalogue: the catalogue
    test wants a role that suits a kid unless the game is listed in `ADULT_GAMES`. You only find out
    at PR time. I added one role, `pilot` / kid.
19. **`startUrl` must be a URL before anything is deployed.** The schema requires a full URL; there
    is no guidance for an undeployed game. I put `https://rock-dodge.example.workers.dev/play` as a
    placeholder; it must be replaced before a catalogue PR.

## Art kit

20. **Where the art lives in my repo.** https://bet4.ogs-docs.pages.dev/art-and-catalogue.md says the
    images live in the OGS repo at `apps/tv/public/art/<appId>/` and the manifest paths are
    `/art/<appId>/...`. Nothing says where to keep them in the game's repo meanwhile. I keep them in
    `art/` and a unit test maps `/art/rock-dodge/x` to `art/x`.
21. **No way to make the art without an art pipeline.** Four images at fixed sizes plus `tv.jpg`, with
    taste rules, and the contact sheet to compare against is in the OGS repo (not on the docs site). I
    drew placeholder art in code (`scripts/make-art.ts`, captured with Playwright). It meets the sizes
    and rules as I read them, but it is programmer art. `tile` is described as "a captured screenshot of
    the TV page"; mine is drawn, not captured.

## Testing

22. **Fixed ports collide.** The starter's `e2e/global-setup.ts` uses fixed ports 8797 (wrangler) and
    8831 (JWKS); testing.md suggests 8787/8831. On this machine another project started a
    `wrangler dev` on 8797 mid-run, the readiness probe (`GET /tv` is ok) accepted it, and 4 phone
    tests failed against the wrong server. I switched to free ports picked at setup, bound to 127.0.0.1.
23. **Hidden elements in "assert the code/QR are gone".** testing.md says to assert the room code, QR
    and name form are gone; Playwright's `getByText`/`getByLabel` count hidden elements, so a naive
    `count() === 0` fails when the element is merely `hidden`. My first test failed for this reason;
    I filter `{ visible: true }`.
24. **Safe-area check has no code.** testing.md and rules.md ask that every element sit inside the 5%
    inset at 1280x720, 1920x1080 and 3840x2160 but give no snippet. I wrote `outsideSafeArea` in
    `e2e/helpers.ts`; I exempt the full-bleed canvas (the field drawn inside it can go to the edge,
    which I judged to be "the scene", not "an element that matters").
25. **Proving "a phone moves something on the TV".** Step 0's done-when has no observable hook for a
    canvas game. I added a read-only `window.__rockDodge()` on the TV page that returns the world, used
    only by seam tests.

## Not possible from here

26. **Step 12 (catalogue PR) and step 5 of testing ("in the real app")** need the OGS repo and the OGS
    app; I was not to push or deploy. Done-when items for the real app (no form on phones, the TV names
    the couch, Home silences, Playing shows the label) are covered only by the stand-in seam tests.

## What changed in response

| # | Fix |
|---|---|
| 1 | Preview builds now rewrite page bodies to their own host; the starter tarball still names production (canonical once deployed) |
| 2, 3 | Starter vendors `vendor/profile-kit.tgz` / `vendor/cast-kit-core.tgz` (quickstart names); a docs test fails if they differ from the hosted kits; `starter:kits` re-vendors |
| 4, 5 | Step 0 lists every file to copy, the dependencies, and the pnpm 9/10 build-script setting |
| 6, 7 | Step 0: keep the original page as the plain-browser game, add `/tv` and a phone page; one player becomes one per phone |
| 8 | Step 7: what a label should be, report on change, `detail` optional |
| 9 | Step 3 and the contract: real-time games stop their simulation while parked |
| 10 | Step 2: resume the AudioContext on first input in a plain browser |
| 11 | Contract: local `~/src` paths replaced with public pointers |
| 12 | `ogs:room` described for every room game (schema comment, so the generated table too) |
| 13 | `ogs:resume-point` marked as the older form |
| 14 | One JWKS answer everywhere; the URL was checked and serves the key set |
| 15 | New cast-kit reference page |
| 16 | Testing: the `cast` store shape and the `SET_VIEW_URL` event to assert |
| 17 | ogs-protocol hosted at `/pkg/ogs-protocol.tgz`; step 10 says to `ManifestSchema.parse` |
| 18, 19, 20 | Step 10: roles need a kid role unless grown-ups only; placeholder `startUrl`; keep art in the repo until the PR |
| 21 | Not fixed: art still needs an art pipeline (programmer art is fine for a first PR, unstated) |
| 22 | Starter seam tests use free ports; testing.md says why |
| 23, 24, 25 | Testing: hidden is not gone; a safe-area snippet; a read-only test hook for canvas games |
| 26 | Not fixable from the docs: needs the OGS app and a catalogue PR |
