# Starter template

**Comet Catch** is a minimal game that already works with OGS: the TV shows the sky, everyone steers
a comet from their phone and catches stars. Fork it, replace the game, keep the OGS wiring. Its
seam tests are the OGS contract, so they tell you when a change breaks it.

```bash
curl -fsSL https://ogs-docs.pages.dev/starter.tgz | tar xz
cd ogs-starter
pnpm install
pnpm dev            # http://localhost:8787/tv, then scan the QR code with a phone
```

Source: [templates/ogs-starter](https://github.com/open-game-system/open-game-system/blob/main/templates/ogs-starter/README.md)
in the OGS repo.

## What's in it

TypeScript, Vite (two pages), one Cloudflare Worker with a Durable Object per room, zod at every
boundary. No framework, so the same wiring drops into Phaser, Three.js or React.

| File | Its part of the OGS contract |
|---|---|
| `tv.html`, `src/tv/main.ts` | The TV page. `getOgsSessionSource()` at module load; on `ogs:start` it hides its room code and QR, `reportOgsRoom(code)` and `reportOgsSitting(...)`; `onOgsPause` silences it |
| `src/tv/audio-pause.ts` | Parked means silent: suspends the `AudioContext` on `ogs:suspend`, resumes it on `ogs:resume` |
| `index.html`, `src/phone/main.ts` | The phone controller (the manifest's `startUrl`). Joins under the OGS profile with no form; the phone that starts the game makes the room and declares `/tv?room=CODE`; a phone opened with `ogsRoom` follows the TV |
| `src/client/ogs-plan.ts` | Every OGS decision as a pure function, unit-tested |
| `src/worker/room.ts` | The room: seats players (`verifyOgsToken` before trusting a name), forwards sticks to the TV |
| `ogs.manifest.json` | The catalogue entry (no `tvUrl`: a room game) |
| `e2e/*.seam.test.ts` | Playwright: the TV page in a stand-in launcher, the phone in a fake OGS app with a local key set |
| `vendor/*.tgz` | profile-kit and cast-kit-core from this site; `pnpm kits:update` fetches the latest |

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Builds the pages and runs the Worker locally (`wrangler dev`, port 8787) |
| `pnpm test` | Unit tests: the game, seating, the OGS decisions, one appId everywhere |
| `pnpm test:seam` | The seam tests (starts its own `wrangler dev` with a local key set) |
| `pnpm typecheck`, `pnpm lint` | TypeScript (pages and Worker separately) and Biome |
| `pnpm run deploy` | Builds and deploys to your Cloudflare account |

## Make it yours

1. Set your `appId` in `ogs.manifest.json` and `OGS_APP_ID` in `wrangler.jsonc` (a test fails until
   they match), and rename the Worker.
2. Replace `src/shared/sim.ts` and the drawing in `src/tv/main.ts` with your game, and the messages in
   `src/shared/protocol.ts`. Keep the OGS lines and the seam tests green.
3. Deploy, then follow [Art kit and catalogue](art-and-catalogue.md) to get into the OGS app.
