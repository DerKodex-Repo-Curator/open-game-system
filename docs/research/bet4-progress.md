# Bet 4 progress: "Your web game on a real TV"

Branch `claude/dev-starter-58fe9a`. Brief: [next-week-bets.md §4](next-week-bets.md) (on the research branch).

## Done
- Kits install outside the monorepo: cast-kit-core / cast-kit-react no longer depend on
  unpublished `@open-game-system/*` versions; profile-kit's `.d.ts` inline ogs-protocol (was `any`).
- `templates/ogs-starter`: Comet Catch, vanilla TS + Vite + Worker + Room DO. 26 unit tests, 8 seam
  tests (stand-in launcher, fake WebView, local JWKS). Checked in a browser: TV makes a room, phone
  joins, steering moves the comet.

## Next
- Docs: host kit tarballs at `/pkg/*.tgz`, fix the install step and the JWKS URL, vanilla
  (no-React) patterns, one-line prompt, llms.txt.
- Fresh-subagent proof on a plain canvas game.
- Landing page + waitlist (Pages Function + D1) + UTM; posts draft.

## Waiting on Jon
- Creating `open-game-system/ogs-starter` on GitHub.
- Deploying ogs-docs to production (previews only so far).
