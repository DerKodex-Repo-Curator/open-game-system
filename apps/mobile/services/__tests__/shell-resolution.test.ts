import { z } from "zod";

/**
 * The shell's code runs in this app (docs/acceptance/2026-10-18-white-label-shell.feature, "Mocked native
 * modules have one copy"). jest.mock("react-native-google-cast") in an app test replaces the module by its
 * resolved real path, so it intercepts the same import from packages/shell/src only when both resolve to
 * the same .pnpm folder: same version AND same peer variant. The shell gets that by declaring each native
 * module as a peer plus a devDependency with exactly this app's specifier (docs/lessons.md).
 */
// The mobile tsconfig has no Node types; jest runs from apps/mobile.
type Fs = {
  readFileSync(path: string, encoding: "utf8"): string;
  existsSync(path: string): boolean;
  realpathSync(path: string): string;
};
type Path = { resolve(...parts: string[]): string; dirname(path: string): string };
const fs = jest.requireActual<Fs>("fs");
const path = jest.requireActual<Path>("path");

const PackageJsonSchema = z.object({
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
  peerDependencies: z.record(z.string(), z.string()).default({}),
  peerDependenciesMeta: z
    .record(z.string(), z.object({ optional: z.boolean().optional() }))
    .default({}),
});

const appDir = path.resolve(".");
const shellDir = path.resolve("../../packages/shell");
const readPackage = (dir: string) =>
  PackageJsonSchema.parse(JSON.parse(fs.readFileSync(path.resolve(dir, "package.json"), "utf8")));

const app = readPackage(appDir);
const shell = readPackage(shellDir);

/** Where Node and Jest find `name` when imported from a file in `fromDir`: the first node_modules up. */
function packageRealPath(fromDir: string, name: string): string {
  let dir = fromDir;
  for (;;) {
    const candidate = path.resolve(dir, "node_modules", name);
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`${name} not found from ${fromDir}`);
    dir = parent;
  }
}

const requiredPeers = Object.keys(shell.peerDependencies).filter(
  (name) => shell.peerDependenciesMeta[name]?.optional !== true,
);

describe("@open-game-system/shell resolves to one copy of each native module", () => {
  it("the app depends on the shell from the workspace", () => {
    expect(app.dependencies["@open-game-system/shell"]).toBe("workspace:*");
  });

  it("declares the native modules the app's tests mock as peers", () => {
    expect(requiredPeers).toEqual(
      expect.arrayContaining([
        "react-native-google-cast",
        "expo-notifications",
        "expo-device",
        "expo-constants",
        "expo-linking",
        "@react-native-async-storage/async-storage",
      ]),
    );
  });

  it.each(requiredPeers)("%s: the shell's peer and dev specifiers are the app's", (name) => {
    expect(shell.peerDependencies[name]).toBe(app.dependencies[name]);
    expect(shell.devDependencies[name]).toBe(app.dependencies[name]);
  });

  it.each(requiredPeers)("%s: same real path from the shell's source and from the app", (name) => {
    expect(packageRealPath(path.resolve(shellDir, "src"), name)).toBe(
      packageRealPath(path.resolve(appDir, "services"), name),
    );
  });

  it("the shell's own dependencies are the app's copies too", () => {
    for (const name of Object.keys(shell.dependencies)) {
      if (app.dependencies[name] === undefined) continue;
      expect(packageRealPath(path.resolve(shellDir, "src"), name)).toBe(
        packageRealPath(path.resolve(appDir, "services"), name),
      );
    }
  });

  it("Jest loads the shell from its TypeScript source (the react-native export condition)", () => {
    // require.resolve is Jest's resolver here; the mobile tsconfig's NodeRequire type doesn't declare it.
    const resolve: unknown = Reflect.get(require, "resolve");
    if (typeof resolve !== "function") throw new Error("require.resolve is missing");
    const resolved = z.string().parse(resolve("@open-game-system/shell"));
    expect(fs.realpathSync(resolved)).toBe(path.resolve(shellDir, "src/index.ts"));
  });
});
