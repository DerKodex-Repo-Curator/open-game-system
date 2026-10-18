# Agent notes

An OGS game: TV page (`tv.html`, `src/tv`), phone controller (`index.html`, `src/phone`), one
Cloudflare Worker with a Room Durable Object per room (`src/worker`). The OGS contract and APIs:
https://ogs-docs.pages.dev/llms.txt (fetch it before changing anything OGS-related).

Before committing: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:seam`.

Rules that keep it OGS-compatible (the seam tests check them):
- Never add a cast button or casting code; OGS casts.
- On the OGS TV (session non-null) show no room code, join QR or "join at" URL.
- Nothing over the middle of the TV; HUD stays inside the 5% safe area.
- The TV goes silent on `ogs:suspend` (`onOgsPause`), comes back on `ogs:resume`.
- Trust a player's name only from `verifyOgsToken` on the server.
- Everything still works in a plain browser: profile-kit returns `null` there.
- Parse every message with zod (`src/shared/protocol.ts`); no `any`, no `as`.
