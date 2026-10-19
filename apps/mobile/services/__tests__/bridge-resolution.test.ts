import { z } from "zod";

/**
 * app-bridge-react-native's source runs in this app (and, through the shell, in every single-game app).
 * Metro and Jest resolve `react`, `react-native` and `react-native-webview` from its source by the first
 * node_modules up, which in the workspace is packages/app-bridge-react-native/node_modules. If that holds
 * other copies than the app's, the app bundles two Reacts ("Invalid hook call") and two React Natives.
 * The package declares them as peers (ranges that include the app's) plus devDependencies with exactly
 * this app's specifiers, so pnpm links the app's own copies there (docs/lessons.md).
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
  version: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
  peerDependencies: z.record(z.string(), z.string()).default({}),
});

const appDir = path.resolve(".");
const bridgeDir = path.resolve("../../packages/app-bridge-react-native");
const readPackage = (dir: string) =>
  PackageJsonSchema.parse(JSON.parse(fs.readFileSync(path.resolve(dir, "package.json"), "utf8")));

const app = readPackage(appDir);
const bridge = readPackage(bridgeDir);

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

/** `>=a.b.c` ranges only (what the package declares): does `version` satisfy it? */
function satisfiesAtLeast(range: string, version: string): boolean {
  const min = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(range);
  const v = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!min || !v) return false;
  for (let i = 1; i <= 3; i++) {
    const a = Number(v[i]);
    const b = Number(min[i]);
    if (a !== b) return a > b;
  }
  return true;
}

const SHARED = ["react", "react-native", "react-native-webview"];

describe("app-bridge-react-native resolves to the app's React, React Native and WebView", () => {
  it.each(SHARED)("%s is a peer, not a dependency", (name) => {
    expect(bridge.peerDependencies[name]).toBeDefined();
    expect(bridge.dependencies[name]).toBeUndefined();
  });

  it.each(SHARED)("%s: the peer range includes the app's version", (name) => {
    const installed = readPackage(packageRealPath(path.resolve(appDir, "services"), name));
    expect(satisfiesAtLeast(z.string().parse(bridge.peerDependencies[name]), z.string().parse(installed.version))).toBe(true);
  });

  it.each(SHARED)("%s: the dev specifier is the app's", (name) => {
    expect(bridge.devDependencies[name]).toBe(app.dependencies[name]);
  });

  it.each(SHARED)("%s: same real path from the bridge's source and from the app", (name) => {
    expect(packageRealPath(path.resolve(bridgeDir, "src"), name)).toBe(
      packageRealPath(path.resolve(appDir, "services"), name),
    );
  });
});
