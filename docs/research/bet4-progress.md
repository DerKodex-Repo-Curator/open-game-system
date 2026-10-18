# Bet 4 progress: "Your web game on a real TV"

Branch `claude/dev-starter-58fe9a`. Brief: next-week-bets.md §4 (research branch, commit be5ee812).

## Done (committed; deployed to previews only)
- **Kits install outside the monorepo.** cast-kit-core / cast-kit-react no longer depend on
  unpublished `@open-game-system/*` versions; profile-kit's `.d.ts` inline ogs-protocol (was `any`).
- **Starter template** `templates/ogs-starter` (Comet Catch): vanilla TS + Vite + Worker + Room DO,
  26 unit + 8 seam tests (stand-in launcher, fake OGS app, local JWKS), CI workflow, MIT. Checked
  in a browser (TV makes a room, a phone joins and steers). Installs and passes from the hosted
  `starter.tgz` in a clean folder.
- **Docs for agents.** Kits hosted at `/pkg/<kit>.tgz`, starter at `/starter.tgz`; llms.txt opens
  with instructions for an agent; one-line prompt ("Make this game OGS-compatible: follow
  https://ogs-docs.pages.dev/llms.txt"); quickstart covers one-screen games (step 0) and no-React
  code; new Starter and cast-kit pages.
- **Proof, round 1** (vanilla canvas Rock Dodge, fresh subagent, docs only): steps 0–11 done,
  36 unit + 17 seam tests passing (re-run by me). 26 friction items → fixed in f14f7551
  ([bet4-proof-1.md](bet4-proof-1.md)).
- **Landing** `/on-tv`: 30 s Bake Shop recorder clip (TV + phone + iPad), one-line prompt, waitlist
  form → Pages Function → D1 (`ogs-docs-waitlist`, previews `ogs-docs-waitlist-preview`), UTM per
  view and per signup, works without JS. `pnpm --filter @open-game-system/docs waitlist:stats`.
- **Posts drafted** in [bet4-posts.md](bet4-posts.md) (not posted).

Previews: https://bet4.ogs-docs.pages.dev (docs + landing), https://bet4.ogs-docs.pages.dev/on-tv

## In progress
- Proof, round 2 (Phaser Paddle Pop, fresh subagent, docs with round-1 fixes).

## Waiting on Jon
- Create `open-game-system/ogs-starter` on GitHub (template repo) from `templates/ogs-starter`.
- Deploy ogs-docs to production (`pnpm --filter @open-game-system/docs deploy`); posts need it.
- Deploy a playable Comet Catch demo Worker (free tier) for HN Arcade / the Phaser forum.
- Optional: a 15 s phone video of a real Chromecast for `/on-tv` (the slot has a recorder clip).
- profile-kit's default JWKS host `api.opengame.org` has no DNS record; docs say to pass the
  workers.dev URL. Point the domain or change the default.
