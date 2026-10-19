import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { missingTargets, packageJsonTargets } from "./packed-paths";

/**
 * A white-label app installs the shell and its workspace packages as packed tarballs (Rocket Crew's
 * vendor/). Every file a package.json points at — main, module, types, react-native (Metro reads
 * it first), exports — must be in the tarball, or the app's bundle breaks. Run after `pnpm build`
 * (turbo's test task builds first).
 */
const PACKAGES = resolve(__dirname, "../..");

const DepsSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
});

const dirOf = (name: string) => join(PACKAGES, name.replace("@open-game-system/", ""));
const readJson = (dir: string): unknown =>
  JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));

/** The shell and every workspace package it needs at run time, transitively. */
function shellWorkspaceDeps(): string[] {
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const pkg = DepsSchema.parse(readJson(dirOf(name)));
    for (const [dep, spec] of Object.entries({ ...pkg.dependencies, ...pkg.peerDependencies }))
      if (spec.startsWith("workspace:")) visit(dep);
  };
  visit("@open-game-system/shell");
  return [...seen].sort();
}

/**
 * The game-side kits a shell game installs the same way (cast button, profile, bridge), in build
 * order. turbo builds only the shell's own dependencies before this test, so a kit with no dist yet
 * is built here first.
 */
const GAME_KITS = [
  "@open-game-system/app-bridge-web",
  "@open-game-system/app-bridge-react",
  "@open-game-system/cast-kit-core",
  "@open-game-system/cast-kit-react",
  "@open-game-system/ogs-protocol",
  "@open-game-system/profile-kit",
];

function packedFiles(dir: string): string[] {
  const out = mkdtempSync(join(tmpdir(), "ogs-pack-"));
  execFileSync("pnpm", ["pack", "--pack-destination", out], { cwd: dir, stdio: "pipe" });
  const [tarball] = readdirSync(out);
  if (!tarball) throw new Error(`pnpm pack wrote nothing for ${dir}`);
  return execFileSync("tar", ["-tzf", join(out, tarball)], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.replace(/^package\//, ""));
}

describe("packed tarballs contain every path their package.json names", () => {
  beforeAll(() => {
    for (const kit of GAME_KITS) {
      const dir = dirOf(kit);
      if (!existsSync(join(dir, "dist")))
        execFileSync("pnpm", ["run", "build"], { cwd: dir, stdio: "pipe" });
    }
  }, 180_000);

  const names = [...new Set([...shellWorkspaceDeps(), ...GAME_KITS])].sort();

  it("covers the shell's own workspace dependencies", () => {
    expect(names).toEqual(
      expect.arrayContaining([
        "@open-game-system/shell",
        "@open-game-system/app-bridge-native",
        "@open-game-system/app-bridge-react-native",
        "@open-game-system/app-bridge-types",
        "@open-game-system/ogs-protocol",
      ]),
    );
  });

  it.each(names)("%s", { timeout: 60_000 }, (name) => {
    const dir = dirOf(name);
    const { targets } = packageJsonTargets(readJson(dir));
    expect(targets.length).toBeGreaterThan(0);
    expect(missingTargets(targets, packedFiles(dir))).toEqual([]);
  });
});
