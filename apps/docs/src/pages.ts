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
