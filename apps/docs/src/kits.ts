import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { REPO_ROOT } from "./paths";

/**
 * The kits a game installs. Not on npm yet: the site hosts each at /pkg/<kit>.tgz. ogs-protocol is
 * there for its schemas (a game can check its manifest with ManifestSchema).
 */
export const KITS = ["profile-kit", "cast-kit-core", "cast-kit-react", "ogs-protocol"] as const;
export const STARTER_DIR = resolve(REPO_ROOT, "templates/ogs-starter");

export interface Hosted {
  /** Path under the site root. */
  path: string;
}

/**
 * Packs every kit from its built dist (turbo builds the kits before the docs) into
 * `<outDir>/pkg/<kit>.tgz`.
 */
export function packKits(outDir: string): Hosted[] {
  const pkgDir = resolve(outDir, "pkg");
  mkdirSync(pkgDir, { recursive: true });
  return KITS.map((kit) => {
    const dir = resolve(REPO_ROOT, "packages", kit);
    if (!existsSync(resolve(dir, "dist")))
      throw new Error(`docs: packages/${kit}/dist missing; build with pnpm turbo run build --filter=@open-game-system/docs`);
    const tmp = mkdtempSync(join(tmpdir(), `ogs-${kit}-`));
    execFileSync("pnpm", ["pack", "--pack-destination", tmp], { cwd: dir, stdio: "ignore" });
    const [file] = readdirSync(tmp).filter((f) => f.endsWith(".tgz"));
    if (!file) throw new Error(`docs: pnpm pack made no tarball for ${kit}`);
    copyFileSync(join(tmp, file), resolve(pkgDir, `${kit}.tgz`));
    rmSync(tmp, { recursive: true, force: true });
    return { path: `pkg/${kit}.tgz` };
  });
}

/** The starter template's tracked files as `<outDir>/starter.tgz` (unpacks to `ogs-starter/`). */
export function packStarter(outDir: string): Hosted {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "."], {
    cwd: STARTER_DIR,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => f && existsSync(resolve(STARTER_DIR, f)))
    .map((f) => `ogs-starter/${f}`);
  mkdirSync(outDir, { recursive: true });
  execFileSync("tar", ["-czf", resolve(outDir, "starter.tgz"), "-C", resolve(STARTER_DIR, ".."), ...files]);
  return { path: "starter.tgz" };
}
