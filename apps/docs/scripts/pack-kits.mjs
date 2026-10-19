#!/usr/bin/env node
// Packs the kits `ogs init` downloads into dist/pkg/<kit>.tgz (GET /api/v1/dev/kits points at them),
// until the kits are on npm. Run after the docs build, before deploying: `pnpm deploy` does both.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The same list as services/api/src/routes/dev.ts (KITS).
const KITS = ["profile-kit", "cast-kit-core", "cast-kit-react", "try-kit"];
const docs = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(docs, "dist", "pkg");
mkdirSync(out, { recursive: true });
for (const kit of KITS) {
  const dir = join(docs, "..", "..", "packages", kit);
  execFileSync("pnpm", ["build"], { cwd: dir, stdio: "inherit" });
  const tmp = mkdtempSync(join(tmpdir(), `pack-${kit}-`));
  execFileSync("pnpm", ["pack", "--pack-destination", tmp], { cwd: dir, stdio: "inherit" });
  const [tgz] = readdirSync(tmp).filter((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`pnpm pack made no tarball for ${kit}`);
  renameSync(join(tmp, tgz), join(out, `${kit}.tgz`));
  rmSync(tmp, { recursive: true });
  console.log(`dist/pkg/${kit}.tgz`);
}
