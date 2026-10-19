import type { Answers } from "./options";

export type AssetName = "icon" | "adaptive-icon" | "splash-icon";

/** Images drawn in code (no binaries in the template): replace them with your art before review. */
export const ASSETS: { name: AssetName; path: string }[] = [
  { name: "icon", path: "assets/icon.png" },
  { name: "adaptive-icon", path: "assets/adaptive-icon.png" },
  { name: "splash-icon", path: "assets/splash-icon.png" },
];

export type FileSource = { kind: "template"; from: string } | { kind: "asset"; asset: AssetName };

export interface PlannedFile {
  /** Path in the new app, `/`-separated. */
  to: string;
  source: FileSource;
}

/**
 * npm drops `.gitignore` and `.npmrc` from a published package, so the template stores them
 * without the dot. `_well-known` keeps the dot-folder visible in the repo.
 */
const RENAMES: Record<string, string> = {
  gitignore: ".gitignore",
  npmrc: ".npmrc",
  "_well-known": ".well-known",
};

const SKIPPED_SEGMENTS = new Set([".DS_Store", "node_modules"]);

/** Files to serve from the developer's own link domain; useless without one. */
const LINK_FILES = "link-files/";

/** Which file goes where in the new app, from the template's file list. */
export function planFiles(templateFiles: string[], answers: Answers): PlannedFile[] {
  const assetPaths = new Set(ASSETS.map((a) => a.path));
  const planned: PlannedFile[] = [];
  for (const file of templateFiles) {
    const from = file.replace(/\\/g, "/");
    const segments = from.split("/");
    if (segments.some((s) => SKIPPED_SEGMENTS.has(s))) continue;
    const to = segments.map((s) => RENAMES[s] ?? s).join("/");
    if (to.startsWith(LINK_FILES) && answers.linkDomains.length === 0) continue;
    if (assetPaths.has(to)) throw new Error(`template has ${to}, which is generated`);
    planned.push({ to, source: { kind: "template", from } });
  }
  for (const asset of ASSETS) {
    planned.push({ to: asset.path, source: { kind: "asset", asset: asset.name } });
  }
  return planned.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
}
