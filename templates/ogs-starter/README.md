# OGS starter: Comet Catch

A minimal web game that already works with [OGS](https://ogs-docs.pages.dev): the TV shows the
sky, everyone steers a comet from their phone and catches stars. Fork it, replace the game, keep the
OGS wiring.

- **In a plain browser** it is an ordinary party game: open `/tv` on a laptop or TV browser, scan the
  QR code with phones, type a name, play.
- **In the OGS app** the phone page skips the name form (players join under their OGS name and
  avatar, verified on the server), the OGS TV frames the TV page with no cast button and no room
  code, every phone on the couch follows the TV into the room, and Home silences the TV.

Stack: TypeScript, Vite (two pages), one Cloudflare Worker with a Durable Object per room, zod at
every boundary. No framework, so the same wiring drops into Phaser, Three.js or React.

## Run it

```bash
pnpm install
pnpm dev            # wrangler dev: builds the pages and serves everything on :8787
```

Open http://localhost:8787/tv, then the QR code (or `http://<your-ip>:8787/?room=CODE`) on a phone.
Arrow keys steer too, for testing on a laptop.

```bash
pnpm test           # unit tests: the game, seating, the OGS decisions, one appId everywhere
pnpm test:seam      # Playwright: the TV page in a stand-in OGS launcher, the phone in a fake OGS app
pnpm typecheck && pnpm lint
pnpm run deploy     # vite build + wrangler deploy (your Cloudflare account)
```

## Where OGS lives

| File | What it does for OGS |
|---|---|
| `src/tv/main.ts` | `getOgsSessionSource()` at module load; `onOgsPause` → silence; on `ogs:start`: hide the code and QR, `reportOgsRoom(code)`, `reportOgsSitting(...)` |
| `src/tv/audio-pause.ts` | Parked means silent: suspend the `AudioContext` on `ogs:suspend`, resume on `ogs:resume` |
| `src/phone/main.ts` | `getOgsProfileSource()`: join with the OGS token, no form; the host phone declares the TV page (`SET_VIEW_URL` via cast-kit-core); `ogsRoomFromUrl` to follow the TV |
| `src/client/ogs-plan.ts` | Every OGS decision as a pure, tested function |
| `src/worker/room.ts` | `verifyOgsToken` before trusting a name; a bad token never gets a seat |
| `ogs.manifest.json` | The catalogue entry (no `tvUrl`: the phone declares `/tv?room=…`) |
| `vendor/*.tgz` | profile-kit and cast-kit-core (not on npm yet). `pnpm kits:update` fetches the latest |

## Make it yours

1. Pick an `appId` (`[a-z0-9-]+`) and set it in `ogs.manifest.json` and `OGS_APP_ID` in
   `wrangler.jsonc` (`pnpm test` fails until they match). Rename the Worker in `wrangler.jsonc`.
2. Replace `src/shared/sim.ts` and the drawing in `src/tv/main.ts` with your game; change the
   messages in `src/shared/protocol.ts`. Keep the OGS lines.
3. Keep the seam tests green: they are the OGS contract.
4. Deploy, then ask for a spot in the OGS catalogue:
   [Art kit and catalogue](https://ogs-docs.pages.dev/art-and-catalogue).

Docs for you and your coding agent: https://ogs-docs.pages.dev (`/llms.txt` for agents).
