import { resolve } from "node:path";
import { CONTENT_DIR, SPEC_FILE } from "./paths";

export interface PageDef {
  /** URL path: `/<slug>` (HTML) and `/<slug>.md` (Markdown). `index` is `/`. */
  slug: string;
  /** Short name in the sidebar. */
  nav: string;
  /** One line for llms.txt and the page's meta description. */
  summary: string;
  /** The Markdown source (absolute path). */
  source: string;
}

const content = (name: string) => resolve(CONTENT_DIR, name);

/** Site order: the sidebar, llms.txt and llms-full.txt all follow it. */
export const PAGES: PageDef[] = [
  {
    slug: "index",
    nav: "Overview",
    summary:
      "What OGS is (cast once, a TV launcher frames games, phones join the couch, games know who's playing) and what a game gets.",
    source: content("index.md"),
  },
  {
    slug: "quickstart",
    nav: "Quickstart for agents",
    summary:
      "A numbered checklist a coding agent can follow end to end to make a web game OGS-compatible, with a copy-paste prompt.",
    source: content("quickstart.md"),
  },
  {
    slug: "contract",
    nav: "The game contract",
    summary:
      "The OGS game contract (single source of truth): manifest, TV page messages, phone page, token verification, rules, multi-couch rooms, planned joining.",
    source: SPEC_FILE,
  },
  {
    slug: "profile-kit",
    nav: "profile-kit reference",
    summary:
      "Every export of @open-game-system/profile-kit (main, /react, /server) with its signature and when to use it.",
    source: content("profile-kit.md"),
  },
  {
    slug: "messages",
    nav: "Messages and manifest",
    summary:
      "Launcher-to-game and game-to-launcher postMessage messages, manifest fields and shared types, generated from the ogs-protocol zod schemas.",
    source: content("messages.md"),
  },
  {
    slug: "notifications",
    nav: "Notifications",
    summary:
      "Push notifications for OGS games: push handles, opting in from the OGS app or your PWA, one send call with your game's API key, pushes while open, taps and links.",
    source: content("notifications.md"),
  },
  {
    slug: "ship-your-own-app",
    nav: "Ship your own app",
    summary:
      "Your game as its own App Store / Play app with casting, profiles, push links and native sign-in: create-ogs-app, configure, register with the ogs CLI, push credentials, EAS builds, App Review notes, link domains.",
    source: content("ship-your-own-app.md"),
  },
  {
    slug: "testing",
    nav: "Testing your game",
    summary:
      "Seam tests that frame your TV page from a stand-in launcher, the phone page in a fake WebView, no-fullscreen and plain-browser checks.",
    source: content("testing.md"),
  },
  {
    slug: "cli",
    nav: "The ogs CLI",
    summary:
      "ogs, the OGS developer tool: init, dev (no device), manifest check, publish, try, push send, and your game's own app (apps register, push credentials, doctor), with the developer API they call.",
    source: content("cli.md"),
  },
  {
    slug: "cli-init",
    nav: "ogs init",
    summary:
      "Add OGS to an existing web game in one command: the kits, ogs.manifest.json, the quickstart's code (optional codemod) and an agent prompt; GET /dev/kits.",
    source: content("cli-init.md"),
  },
  {
    slug: "cli-dev",
    nav: "ogs dev",
    summary:
      "Run your game with a fake OGS app and TV, fake game tokens with their own JWKS, and QR codes for real phones; no device needed.",
    source: content("cli-dev.md"),
  },
  {
    slug: "cli-catalogue",
    nav: "ogs manifest check and publish",
    summary:
      "Check ogs.manifest.json (schema, catalogue rules, live URLs; POST /manifests/check) and submit the game's catalogue entry for review (PUT /apps/:appId/catalogue-entry).",
    source: content("cli-catalogue.md"),
  },
  {
    slug: "cli-deliver",
    nav: "ogs try and ogs push send",
    summary:
      "Deploy and register a game's try path (ogs try, PUT /apps/:appId/try) and send a test push or push link to your own handle (ogs push send, the notifications API and the handle check).",
    source: content("cli-deliver.md"),
  },
  {
    slug: "try-kit",
    nav: "try-kit: no-app try path",
    summary:
      "Let a stranger play from one link with no app or account: room codes that recycle, dead-end pages, a blocked-WebSocket banner, the QR, play-on-this-computer, ?ref= events and a load runner.",
    source: content("try-kit.md"),
  },
  {
    slug: "art-and-catalogue",
    nav: "Art kit and catalogue",
    summary:
      "The four art-kit images (sizes and rules) and how to submit a game to the OGS catalogue.",
    source: content("art-and-catalogue.md"),
  },
  {
    slug: "rules",
    nav: "Rules and taste",
    summary:
      "What an OGS game must and must not do: no cast button, no join codes, nothing over the TV's focal area, safe area, silent when parked, works in a plain browser.",
    source: content("rules.md"),
  },
];

export const htmlPath = (slug: string) => (slug === "index" ? "/" : `/${slug}`);
