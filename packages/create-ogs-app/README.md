# create-ogs-app

Ship your OGS web game as its own iOS and Android app: an Expo app on the
[`@open-game-system/shell`](../shell/README.md) plugin (casting, profiles, push links, native
sign-in). In your game's repo:

```bash
pnpm create ogs-app app
```

`pnpm create ogs-app --help` lists the flags. The walkthrough is
[Ship your game as its own app](../../apps/docs/content/ship-your-own-app.md); the app it makes has
its own README (`template/README.md`).

## Maintainers

`template/` is copied with its `__OGS_<NAME>__` placeholders filled (`src/placeholders.ts`); icons
are drawn in code (`src/png.ts`). `--shell-version` overrides the `@open-game-system/shell` range the
app depends on (default `SHELL_VERSION` in `src/options.ts`).

Unit and CLI tests (Vitest; `test/bin.test.ts` packs the package):

```bash
pnpm --filter create-ogs-app test
```

```bash
pnpm --filter create-ogs-app test:mutate
```

### End to end on a simulator

`scripts/e2e-simulator.sh` goes from a clean directory to the game on an iOS simulator, as a
developer would, with nothing from the workspace but published packages:

1. starts a throwaway Verdaccio (`npx verdaccio@6`, `127.0.0.1` on a free port, temp storage,
   npmjs for everything else);
2. builds create-ogs-app, the shell and every workspace package the shell needs, and publishes them
   there at `<version>-e2e.<timestamp>` (`scripts/e2e-publish.mjs` changes the package.json versions
   only while packing and puts them back, also when killed);
3. in a fresh temp dir with only `npm_config_registry` set: `pnpm create ogs-app e2e-game --app-id
   e2e-game --name "E2E Game" --game-url <Rocket Crew's /host> --bundle-id com.example.e2egame
   --team-id - --no-link-domain --shell-version <the published version> -y`, `pnpm install`,
   `pnpm typecheck`, `npx expo prebuild --platform ios`, a Release simulator build (`xcodebuild`, the
   JS bundle embedded, no Metro);
4. creates its own simulator, installs and launches the app, and Maestro waits for text only the
   game's page shows (Rocket Crew's "Who's playing here?", "Joining …" or "Captain: …");
5. on exit, pass or fail, stops the registry, deletes the simulator and removes the temp dirs.

First run (2026-10-19, a shared Mac under heavy load): 21 min, of which the Release `xcodebuild` took
13.5 min, prebuild (CocoaPods) 2.3 min, registry start 1 min, simulator boot 1.5 min, Maestro 1 min;
create + install + typecheck under 1 min. The page showed Rocket Crew's "Who's playing here?" (no
OGS profile: `e2e-game` is not in the catalogue).

Needs macOS with Xcode, CocoaPods, Maestro (`~/.maestro/bin/maestro`) and network (npmjs,
CocoaPods, the game). From the repo root:

```bash
packages/create-ogs-app/scripts/e2e-simulator.sh
```

`E2E_LOGS=<dir>` keeps the step logs, `timings.txt`, the Maestro output and a simulator screenshot;
`E2E_KEEP=1` keeps the app, the build and the simulator; `E2E_GAME_URL` / `E2E_EXPECT` point it at
another game. Other options are at the top of the script. It is not in GitHub CI (macOS runners
cost); run it before changing the template, the shell's native dependencies or the plugin.
