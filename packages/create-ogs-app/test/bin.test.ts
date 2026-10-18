import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const PACKAGE_DIR = resolve(__dirname, "..");
const BIN = join(PACKAGE_DIR, "dist/bin.mjs");

beforeAll(() => {
  execFileSync("pnpm", ["exec", "tsdown"], { cwd: PACKAGE_DIR, stdio: "pipe" });
}, 60_000);

describe("the published package", () => {
  it("the bin is an ESM file node can run directly", () => {
    expect(readFileSync(BIN, "utf8").split("\n")[0]).toBe("#!/usr/bin/env node");
  });

  it("runs from its own folder (a local path today, pnpm create ogs-app once published)", () => {
    const cwd = mkdtempSync(join(tmpdir(), "create-ogs-app-bin-"));
    const run = spawnSync(
      "node",
      [
        BIN,
        "rocket",
        "--app-id",
        "rocket-crew",
        "--game-url",
        "https://rocketcrew.tv/phone",
        "--team-id",
        "34S957HD77",
        "--yes",
      ],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("cd rocket");
    expect(existsSync(join(cwd, "rocket/app.config.ts"))).toBe(true);
    expect(existsSync(join(cwd, "rocket/.gitignore"))).toBe(true);
  });

  it("packs the template with the files npm would otherwise drop", () => {
    const out = mkdtempSync(join(tmpdir(), "create-ogs-app-pack-"));
    execFileSync("pnpm", ["pack", "--pack-destination", out], { cwd: PACKAGE_DIR, stdio: "pipe" });
    const [tarball] = readdirSync(out);
    if (!tarball) throw new Error("no tarball");
    const files = execFileSync("tar", ["-tzf", join(out, tarball)], { encoding: "utf8" })
      .split("\n")
      .filter((f) => f.length > 0);
    expect(files).toEqual(
      expect.arrayContaining([
        "package/package.json",
        "package/dist/bin.mjs",
        "package/template/gitignore",
        "package/template/npmrc",
        "package/template/app.config.ts",
        "package/template/link-files/_well-known/apple-app-site-association",
      ]),
    );
    expect(files.filter((f) => f.startsWith("package/src/"))).toEqual([]);
  }, 60_000);
});
