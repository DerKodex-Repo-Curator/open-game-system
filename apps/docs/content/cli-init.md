# ogs init: add OGS to an existing web game

`ogs init` turns a web game's repository into one that is ready to become OGS-compatible: it writes
the manifest, puts the kits in `vendor/`, adds them to `package.json`, and writes `OGS.md`, the
[quickstart](quickstart.md) as a checklist for this repo with a prompt for your coding agent. With
`--codemod` it also adds the first lines of OGS code to your TV page and your phone page when it can
tell which files those are.

It never runs your package manager and never overwrites code it isn't sure about. It works out every
change first (downloading the kits), prints the plan, and only then writes: a failure, or `--dry`,
leaves the repo as it was.

## Usage

Run it at the root of the game's repo:

```bash
ogs init --app-id comet-catch --name "Comet Catch" --start-url https://comet.example/
```

| Flag | What it sets | Default |
|---|---|---|
| `--app-id <id>` | `appId`: lowercase letters, digits and hyphens. It names your game everywhere (catalogue, art folder, the `aud` of game tokens) | required |
| `--name <name>` | `name` | required |
| `--start-url <url>` | `startUrl`: the phone page | required |
| `--tv-url <url>` | `tvUrl`: a static TV page. Leave it out for a room game whose phone page declares the TV page per room | none |
| `--shape couch\|live\|async` | `shape` | `couch` |
| `--tv none\|optional\|required` | `tv`: what the game needs from a TV | `required` with `--tv-url`, else `optional` |
| `--codemod` | also add the TV and phone hookups (below) | off |
| `--dry` | print the plan and change nothing (it still reads `GET /api/v1/dev/kits`, and downloads nothing) | off |

At a terminal, `ogs init` asks for the required fields you left out (and for a TV page URL). With no
terminal (CI, an agent's shell) it asks nothing: missing required flags exit 2 and name the flags.

Environment: `OGS_API` (the API base, for example a preview).

## What it does

1. **Reads the repo.** The package manager from `package.json`'s `packageManager`, else the
   lockfile (`pnpm-lock.yaml`, `bun.lock`/`bun.lockb`, `yarn.lock`, `package-lock.json`), else npm.
   The framework: TanStack Start (`@tanstack/react-start`, `@tanstack/solid-start`), Next.js (`next`
   or `next.config.*`), Vite (`vite` or `vite.config.*`), else plain HTML.
2. **Writes `ogs.manifest.json`** from the flags, with the art kit's usual paths
   (`/art/<appId>/tv.jpg`, `icon.png`, `cover.jpg`, `logo.png`, `hero-clean.jpg`), and checks it with
   `ManifestSchema` from `@open-game-system/ogs-protocol`. A manifest that is already there is kept
   (flags don't change it); if it isn't valid, `ogs init` lists its issues and exits 1.
3. **Downloads the kits** that `GET /api/v1/dev/kits` lists into `vendor/` (`vendor/profile-kit.tgz`,
   …), refusing anything that isn't a gzip tarball, and adds each to `dependencies` as
   `file:vendor/<file>`. A dependency your `package.json` already has under another spec is left as it
   is (and said). With no `package.json`, it writes one. Commit `vendor/`: the `file:` dependencies
   need it.
4. **Writes `OGS.md`**: the quickstart's thirteen steps as checkboxes for this repo (your appId, install
   command, kits and entry files), the agent prompt, and the `llms.txt` link. An `OGS.md` that is
   already there is kept.
5. **Prints the next step**: your package manager's install command (`pnpm install`, `npm install`,
   …). Run it yourself.

Running `ogs init` again is safe: it keeps your manifest and `OGS.md`, adds no dependency twice and
refreshes the kits in `vendor/`.

### `--codemod`

`ogs init` looks for the TV page's entry module (the module script of `tv.html` or `tv/index.html`,
or `src/tv.*`, `src/tv/main.*`, `src/tv/index.*`) and the phone page's (`phone.html`,
`controller.html`, `src/phone.*`, `src/controller.*`, or `index.html`'s script when a separate TV page
exists). It changes a file only when all of these hold:

- the game is a Vite game;
- exactly one file is the candidate for that page;
- the file doesn't import `@open-game-system/profile-kit` yet.

Then it adds the hookup after the file's imports and prints the added lines. The TV page gets the
launcher hookup ([quickstart step 3](quickstart.md)):

```ts
import { getOgsSessionSource, onOgsPause } from "@open-game-system/profile-kit";

getOgsSessionSource(); // the launcher sends ogs:start as soon as the frame loads
onOgsPause((paused) => {
  // ogs:suspend → true, ogs:resume → false: suspend and resume your AudioContext here (OGS.md step 3).
  document.documentElement.toggleAttribute("data-ogs-paused", paused);
});
```

The phone page gets the profile ([quickstart step 5](quickstart.md)):

```ts
import { getOgsProfileSource } from "@open-game-system/profile-kit";

export const ogsProfile = getOgsProfileSource();
```

Otherwise it changes nothing and prints the snippet and where it goes: the candidates when there are
several, "the module that boots your TV page" when there is none, client-only code for Next.js and
TanStack Start (profile-kit reads `window`), and, for plain HTML, a note that the kits need a bundler or
an import map. A file is never rewritten, only added to.

## Examples

See the plan without changing anything:

```text
$ ogs init --app-id comet-catch --name "Comet Catch" --start-url https://comet.example/ --codemod --dry
ogs init: Comet Catch (comet-catch)
Vite game, pnpm (pnpm-lock.yaml)

  write  ogs.manifest.json
  write  vendor/profile-kit.tgz  (https://ogs-docs.pages.dev/pkg/profile-kit.tgz)
  write  vendor/cast-kit-core.tgz  (https://ogs-docs.pages.dev/pkg/cast-kit-core.tgz)
  write  vendor/cast-kit-react.tgz  (https://ogs-docs.pages.dev/pkg/cast-kit-react.tgz)
  write  vendor/try-kit.tgz  (https://ogs-docs.pages.dev/pkg/try-kit.tgz)
  edit   package.json  (+ @open-game-system/profile-kit, @open-game-system/cast-kit-core, @open-game-system/cast-kit-react, @open-game-system/try-kit)
  write  OGS.md
  edit   src/tv.ts  (the TV page's launcher hookup)
  edit   src/main.ts  (the phone page's profile hookup)

Dry run: nothing changed.
```

From an agent's shell (no terminal): pass every required flag, or it exits 2:

```text
$ ogs init --name "Comet Catch"
ogs init: missing --app-id, --start-url (no terminal to ask in)
```

## Exit codes

| Code | When |
|---|---|
| 0 | done (or the plan printed, with `--dry`) |
| 1 | the API answered an error, a kit didn't download or isn't a tarball, the existing `ogs.manifest.json` isn't valid, or `package.json` isn't valid JSON |
| 2 | usage: an unknown flag, required flags missing with no terminal, or flags that make an invalid manifest (the schema's issues are printed) |

## The endpoint

### `GET /api/v1/dev/kits` (public)

No key. Cached for 5 minutes (`Cache-Control: public, max-age=300`). Where the docs are and the kit
tarballs every game vendors:

```json
{
  "docs": "https://ogs-docs.pages.dev",
  "llms": "https://ogs-docs.pages.dev/llms.txt",
  "quickstart": "https://ogs-docs.pages.dev/quickstart.md",
  "kits": [
    {
      "name": "@open-game-system/profile-kit",
      "file": "profile-kit.tgz",
      "url": "https://ogs-docs.pages.dev/pkg/profile-kit.tgz"
    },
    { "name": "@open-game-system/cast-kit-core", "file": "cast-kit-core.tgz", "url": "https://ogs-docs.pages.dev/pkg/cast-kit-core.tgz" },
    { "name": "@open-game-system/cast-kit-react", "file": "cast-kit-react.tgz", "url": "https://ogs-docs.pages.dev/pkg/cast-kit-react.tgz" },
    { "name": "@open-game-system/try-kit", "file": "try-kit.tgz", "url": "https://ogs-docs.pages.dev/pkg/try-kit.tgz" }
  ]
}
```

The docs base is the API's `OGS_DOCS_BASE` (default `https://ogs-docs.pages.dev`; a trailing slash is
dropped). One that isn't an http(s) URL answers
`500 { "error": { "code": "docs_base_invalid", "message": "OGS_DOCS_BASE is not an http(s) URL", "status": 500 } }`.
