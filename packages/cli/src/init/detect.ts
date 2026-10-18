import { join } from "node:path";
import { z } from "zod";
import type { Files } from "../io";

/** What `ogs init` reads from the game's repo: its package manager and its framework. */
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";
export type Framework = "vite" | "plain" | "next" | "tanstack-start";

export const FRAMEWORK_NAMES: Record<Framework, string> = {
  vite: "Vite",
  plain: "plain HTML",
  next: "Next.js",
  "tanstack-start": "TanStack Start",
};

const LOCKFILES: [string, PackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

const PackageJsonSchema = z.looseObject({
  packageManager: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

/** package.json at `root`, or null when there is none or it isn't JSON of that shape. */
export function readPackageJson(fs: Files, root: string) {
  const path = join(root, "package.json");
  if (!fs.exists(path)) return null;
  try {
    const parsed = PackageJsonSchema.safeParse(JSON.parse(fs.read(path)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const PackageManagerSchema = z.enum(["pnpm", "npm", "yarn", "bun"]);

/** package.json's `packageManager` first, then the lockfile; npm when there is neither (`from: null`). */
export function detectPackageManager(
  fs: Files,
  root: string,
): { pm: PackageManager; from: string | null } {
  const declared = PackageManagerSchema.safeParse(
    readPackageJson(fs, root)?.packageManager?.split("@")[0],
  );
  if (declared.success) return { pm: declared.data, from: "packageManager" };
  const lock = LOCKFILES.find(([file]) => fs.exists(join(root, file)));
  return lock ? { pm: lock[1], from: lock[0] } : { pm: "npm", from: null };
}

export const installCommand = (pm: PackageManager) => `${pm} install`;

const configFile = (fs: Files, root: string, name: string) =>
  ["ts", "mts", "js", "mjs", "cjs"].some((ext) => fs.exists(join(root, `${name}.config.${ext}`)));

/** TanStack Start and Next before Vite (Start runs on Vite); anything else is plain HTML. */
export function detectFramework(fs: Files, root: string): Framework {
  const pkg = readPackageJson(fs, root);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const has = (name: string) => name in deps;
  if (has("@tanstack/react-start") || has("@tanstack/solid-start") || has("@tanstack/start"))
    return "tanstack-start";
  if (has("next") || configFile(fs, root, "next")) return "next";
  if (has("vite") || configFile(fs, root, "vite")) return "vite";
  return "plain";
}
