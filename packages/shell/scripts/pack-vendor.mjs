#!/usr/bin/env node
// Packs @open-game-system/shell and the workspace packages it needs into <dest> (an app's vendor/
// folder) and prints the package.json entries that install them: the shell as a file: dependency,
// the others as pnpm.overrides (a packed package names its workspace deps by version, which isn't
// on npm). Build first: pnpm --filter "@open-game-system/shell..." run build
//
//   node packages/shell/scripts/pack-vendor.mjs ~/src/rocket-crew-app/app/vendor
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const dest = resolve(process.argv[2] ?? "vendor");
const packages = resolve(import.meta.dirname, "../..");
const dirOf = (name) => join(packages, name.replace("@open-game-system/", ""));

/** The shell and its workspace dependencies, transitively. */
const names = [];
const visit = (name) => {
  if (names.includes(name)) return;
  names.push(name);
  const pkg = JSON.parse(readFileSync(join(dirOf(name), "package.json"), "utf8"));
  for (const [dep, spec] of Object.entries({ ...pkg.dependencies, ...pkg.peerDependencies }))
    if (String(spec).startsWith("workspace:")) visit(dep);
};
visit("@open-game-system/shell");

mkdirSync(dest, { recursive: true });
const tarballs = {};
for (const name of names) {
  const prefix = `${name.replace("@", "").replace("/", "-")}-`;
  for (const old of readdirSync(dest).filter((f) => f.startsWith(prefix) && f.endsWith(".tgz")))
    rmSync(join(dest, old));
  const out = execFileSync("pnpm", ["pack", "--pack-destination", dest], {
    cwd: dirOf(name),
    encoding: "utf8",
  });
  const file = out.trim().split("\n").pop();
  tarballs[name] = `file:${relative(resolve(dest, ".."), join(dest, basename(file)))}`;
}

const [shell, ...rest] = names;
console.log(
  JSON.stringify(
    {
      dependencies: { [shell]: tarballs[shell] },
      pnpm: { overrides: Object.fromEntries(rest.map((n) => [n, tarballs[n]])) },
    },
    null,
    2,
  ),
);
