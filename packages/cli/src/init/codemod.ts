import { dirname, join, relative, sep } from "node:path";
import type { Files } from "../io";

/**
 * `ogs init --codemod`: finds the TV page's and the phone page's entry files and adds profile-kit's
 * hookup to each, only when exactly one file is the candidate and it doesn't use profile-kit yet.
 * Everything else is printed for the developer (or their agent) to place.
 */

export const TV_SNIPPET = `// OGS (added by ogs init --codemod; OGS.md step 3): hear the launcher from module load.
import { getOgsSessionSource, onOgsPause } from "@open-game-system/profile-kit";

getOgsSessionSource(); // the launcher sends ogs:start as soon as the frame loads
onOgsPause((paused) => {
  // ogs:suspend → true, ogs:resume → false: suspend and resume your AudioContext here (OGS.md step 3).
  document.documentElement.toggleAttribute("data-ogs-paused", paused);
});`;

export const PHONE_SNIPPET = `// OGS (added by ogs init --codemod; OGS.md step 5): the player's OGS profile inside the OGS app.
import { getOgsProfileSource } from "@open-game-system/profile-kit";

// getSnapshot(): undefined while asking the app, null in a plain browser (keep your name form),
// else { name, avatar, token }: join at once under that name. subscribe(listener) for changes.
export const ogsProfile = getOgsProfileSource();`;

const EXT = ["ts", "tsx", "js", "jsx", "mjs"];
const named = (stems: string[]) => stems.flatMap((stem) => EXT.map((ext) => `${stem}.${ext}`));

const TV_PAGES = ["tv.html", "tv/index.html"];
const TV_NAMES = named(["src/tv", "src/tv/main", "src/tv/index", "src/tv-main", "src/main-tv"]);
const PHONE_PAGES = ["phone.html", "controller.html", "phone/index.html", "controller/index.html"];
const PHONE_NAMES = named([
  "src/phone",
  "src/phone/main",
  "src/phone/index",
  "src/controller",
  "src/controller/main",
  "src/controller/index",
]);

const toPosix = (path: string) => path.split(sep).join("/");

/** The local module scripts a page loads (repo-relative paths that exist). */
function pageScripts(fs: Files, root: string, page: string): string[] {
  const path = join(root, page);
  if (!fs.exists(path)) return [];
  const scripts: string[] = [];
  for (const [, attrs = ""] of fs.read(path).matchAll(/<script\b([^>]*)>/g)) {
    if (!/\btype\s*=\s*["']module["']/.test(attrs)) continue;
    const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/)?.[1];
    if (!src || /^([a-z]+:)?\/\//i.test(src)) continue;
    const file = src.startsWith("/") ? join(root, src.slice(1)) : join(dirname(path), src);
    if (fs.exists(file)) scripts.push(toPosix(relative(root, file)));
  }
  return scripts;
}

const existing = (fs: Files, root: string, paths: string[]) =>
  paths.filter((p) => fs.exists(join(root, p)));

/**
 * Every candidate entry for the TV page and the phone page. index.html counts as the phone page only
 * when a separate TV entry exists (one page for both is not something to patch blindly).
 */
export function findEntries(fs: Files, root: string): { tv: string[]; phone: string[] } {
  const tv = [
    ...new Set([
      ...TV_PAGES.flatMap((p) => pageScripts(fs, root, p)),
      ...existing(fs, root, TV_NAMES),
    ]),
  ];
  let phone = [
    ...new Set([
      ...PHONE_PAGES.flatMap((p) => pageScripts(fs, root, p)),
      ...existing(fs, root, PHONE_NAMES),
    ]),
  ];
  if (phone.length === 0 && tv.length > 0)
    phone = pageScripts(fs, root, "index.html").filter((s) => !tv.includes(s));
  return { tv, phone };
}

const IMPORT_END = /(\bfrom\s*["'][^"']+["']|^import\s*["'][^"']+["'])\s*;?\s*$/;

/**
 * `source` with `snippet` after its leading imports (and any directive, shebang or comment before
 * them); null when the file already imports profile-kit.
 */
export function insertAfterImports(source: string, snippet: string): string | null {
  if (source.includes("@open-game-system/profile-kit")) return null;
  const lines = source.split("\n");
  let at = 0;
  let inImport = false;
  for (const [i, line] of lines.entries()) {
    const text = line.trim();
    if (inImport) {
      if (IMPORT_END.test(text)) {
        inImport = false;
        at = i + 1;
      }
      continue;
    }
    if (text === "") continue;
    if (/^import[\s{*"']/.test(text)) {
      inImport = !IMPORT_END.test(text);
      if (!inImport) at = i + 1;
      continue;
    }
    if (/^(#!|\/\/|\/\*|\*)/.test(text) || /^["']use [\w ]+["'];?$/.test(text)) {
      at = i + 1;
      continue;
    }
    break;
  }
  return [...lines.slice(0, at), snippet, ...lines.slice(at)].join("\n");
}
