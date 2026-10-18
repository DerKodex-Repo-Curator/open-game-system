import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { KITS, packKits, packStarter, STARTER_DIR } from "../src/kits";

/**
 * The docs site hosts the kits as tarballs (they are not on npm), so a game outside the monorepo
 * can vendor them with one curl. A tarball is only useful if it installs from npm alone.
 */
const out = mkdtempSync(join(tmpdir(), "ogs-kits-"));
const kits = packKits(out);
const starter = packStarter(out);

const tarList = (file: string) => execFileSync("tar", ["-tzf", file], { encoding: "utf8" }).split("\n");
const tarRead = (file: string, entry: string) => execFileSync("tar", ["-xzOf", file, entry], { encoding: "utf8" });
const Pkg = z.object({
  name: z.string(),
  dependencies: z.record(z.string(), z.string()).default({}),
  peerDependencies: z.record(z.string(), z.string()).default({}),
});

describe("the hosted kits", () => {
  it("packs profile-kit, cast-kit-core, cast-kit-react and ogs-protocol to /pkg/<kit>.tgz", () => {
    expect(kits.map((k) => k.path)).toEqual(KITS.map((k) => `pkg/${k}.tgz`));
  });

  it.each(KITS)("%s depends only on packages that are on npm", (kit) => {
    const pkg = Pkg.parse(JSON.parse(tarRead(join(out, `pkg/${kit}.tgz`), "package/package.json")));
    expect(pkg.name).toBe(`@open-game-system/${kit}`);
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
    expect(deps.filter((d) => d.startsWith("@open-game-system/"))).toEqual([]);
    expect(Object.values(pkg.dependencies).filter((v) => v.startsWith("workspace:"))).toEqual([]);
  });

  it.each(KITS)("%s ships JS and types that import no unpublished package", (kit) => {
    const file = join(out, `pkg/${kit}.tgz`);
    const code = tarList(file).filter((e) => /\.(mjs|cjs|d\.mts|d\.cts)$/.test(e));
    expect(code.length).toBeGreaterThan(0);
    for (const entry of code) expect(tarRead(file, entry), entry).not.toMatch(/from ["']@open-game-system\//);
  });
});

describe("the hosted starter", () => {
  it.each(["profile-kit", "cast-kit-core"])("vendors the same %s the site hosts", (kit) => {
    const vendored = join(STARTER_DIR, "vendor", `${kit}.tgz`);
    const hosted = join(out, `pkg/${kit}.tgz`);
    const files = tarList(hosted).filter((e) => e && !e.endsWith("/"));
    expect(tarList(vendored).filter((e) => e && !e.endsWith("/")).sort()).toEqual([...files].sort());
    for (const entry of files) {
      const [a, b] = [tarRead(vendored, entry), tarRead(hosted, entry)];
      // pnpm pack orders package.json's keys differently from run to run: compare it as data.
      const same = entry.endsWith("package.json") ? [JSON.parse(a), JSON.parse(b)] : [a, b];
      expect(same[0], `${entry}: re-vendor with pnpm kits:update`).toEqual(same[1]);
    }
  });

  it("packs templates/ogs-starter to /starter.tgz from its tracked files only", () => {
    expect(starter.path).toBe("starter.tgz");
    const entries = tarList(join(out, "starter.tgz"));
    expect(entries).toContain("ogs-starter/package.json");
    expect(entries).toContain("ogs-starter/src/tv/main.ts");
    expect(entries).toContain("ogs-starter/vendor/profile-kit.tgz");
    expect(entries.some((e) => e.includes("node_modules/"))).toBe(false);
  });
});
