#!/usr/bin/env node
// Publishes create-ogs-app, @open-game-system/shell and every workspace package the shell needs to a
// throwaway registry, at `<version>-<suffix>` (a prerelease no one else has), for e2e-simulator.sh.
// Build first: pnpm --filter "@open-game-system/shell..." --filter create-ogs-app run build
//
//   node e2e-publish.mjs publish <registry> <suffix> <workDir>   → prints the shell's version last
//   node e2e-publish.mjs restore <workDir>                         → puts package.json files back
//
// The package.json versions change only while `pnpm pack` runs (pnpm writes the workspace:* deps as
// those versions); a backup in <workDir> lets `restore` undo it if the run is killed mid-pack.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const packagesDir = resolve(import.meta.dirname, "../..");
const dirOf = (name) =>
  join(packagesDir, name === "create-ogs-app" ? name : name.replace("@open-game-system/", ""));
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const backupFile = (workDir) => join(workDir, "package-json-backup.json");

function restore(workDir) {
  const file = backupFile(workDir);
  if (!existsSync(file)) return;
  for (const [path, text] of Object.entries(readJson(file))) writeFileSync(path, text);
  rmSync(file);
}

/** The shell and its workspace dependencies (dependencies and peers, transitively), then the CLI. */
function packageNames() {
  const names = [];
  const visit = (name) => {
    if (names.includes(name)) return;
    names.push(name);
    const pkg = readJson(join(dirOf(name), "package.json"));
    for (const [dep, spec] of Object.entries({ ...pkg.dependencies, ...pkg.peerDependencies }))
      if (String(spec).startsWith("workspace:")) visit(dep);
  };
  visit("@open-game-system/shell");
  return [...names, "create-ogs-app"];
}

function publish(registry, suffix, workDir) {
  const names = packageNames();
  const manifests = names.map((name) => join(dirOf(name), "package.json"));
  const originals = Object.fromEntries(manifests.map((path) => [path, readFileSync(path, "utf8")]));
  const versions = {};
  const tarballs = join(workDir, "tarballs");
  mkdirSync(tarballs, { recursive: true });
  writeFileSync(backupFile(workDir), JSON.stringify(originals));
  try {
    for (const [i, path] of manifests.entries()) {
      const pkg = JSON.parse(originals[path]);
      pkg.version = `${pkg.version.split("-")[0]}-${suffix}`;
      versions[names[i]] = pkg.version;
      writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
    }
    for (const name of names) {
      const out = execFileSync("pnpm", ["pack", "--pack-destination", tarballs], {
        cwd: dirOf(name),
        encoding: "utf8",
      });
      versions[`${name} tarball`] = join(tarballs, basename(out.trim().split("\n").pop()));
    }
  } finally {
    restore(workDir);
  }
  for (const name of names) {
    // --ignore-scripts: the tarball is final (some packages' prepublishOnly rewrites package.json).
    execFileSync(
      "npm",
      [
        "publish",
        versions[`${name} tarball`],
        "--registry",
        registry,
        "--tag",
        "latest",
        "--ignore-scripts",
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    console.log(`published ${name}@${versions[name]}`);
  }
  console.log(versions["@open-game-system/shell"]);
}

const [command, ...args] = process.argv.slice(2);
if (command === "publish" && args.length === 3) {
  const workDir = resolve(args[2]);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      restore(workDir);
      process.exit(1);
    });
  publish(args[0], args[1], workDir);
} else if (command === "restore" && args.length === 1) {
  restore(resolve(args[0]));
} else {
  console.error("usage: e2e-publish.mjs publish <registry> <suffix> <workDir> | restore <workDir>");
  process.exit(2);
}
