import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { type CliIO, main } from "../src/cli";
import { findPlaceholders } from "../src/placeholders";

const PACKAGE_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolve(PACKAGE_DIR, "../..");

const PackageJsonSchema = z.object({
  name: z.string(),
  main: z.string().optional(),
  dependencies: z.record(z.string()).default({}),
  devDependencies: z.record(z.string()).default({}),
  peerDependencies: z.record(z.string()).default({}),
  peerDependenciesMeta: z.record(z.object({ optional: z.boolean().optional() })).default({}),
});
const readPackageJson = (file: string) =>
  PackageJsonSchema.parse(JSON.parse(readFileSync(file, "utf8")));

/** Every file under `dir`, relative and `/`-separated. */
function walk(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split("\\").join("/"))
    .sort();
}

function fakeIO(cwd: string, replies: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    cwd,
    ask: async () => replies.shift() ?? "",
    log: (m) => out.push(m),
    error: (m) => err.push(m),
  };
  return { io, out, err };
}

const rocketCrewFlags = [
  "--app-id",
  "rocket-crew",
  "--name",
  "Rocket Crew",
  "--game-url",
  "https://rocketcrew.tv/phone",
  "--team-id",
  "34S957HD77",
  "--yes",
];

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "create-ogs-app-"));
});

describe("create-ogs-app generates an app", () => {
  it("writes the template, filled in, with generated icons", async () => {
    const { io, out } = fakeIO(cwd);
    expect(await main(["app", ...rocketCrewFlags], io)).toBe(0);
    const app = join(cwd, "app");
    expect(walk(app)).toEqual([
      ".gitignore",
      ".npmrc",
      "README.md",
      "REVIEW_NOTES.md",
      "app.config.ts",
      "app/+native-intent.ts",
      "app/_layout.tsx",
      "app/index.tsx",
      "assets/adaptive-icon.png",
      "assets/icon.png",
      "assets/splash-icon.png",
      "eas.json",
      "examples/README.md",
      "examples/server/send-push-link.ts",
      "examples/web/cast-button.tsx",
      "examples/web/in-own-app.ts",
      "examples/web/phone-page.tsx",
      "examples/web/player-badge.tsx",
      "link-files/.well-known/apple-app-site-association",
      "link-files/.well-known/assetlinks.json",
      "link-files/README.md",
      "package.json",
      "tsconfig.json",
    ]);
    expect(out.join("\n")).toContain("ogs login --app rocket-crew");
  });

  it("leaves no placeholder anywhere", async () => {
    const { io } = fakeIO(cwd);
    await main(["app", ...rocketCrewFlags], io);
    const app = join(cwd, "app");
    const left = walk(app)
      .filter((f) => !f.endsWith(".png"))
      .flatMap((f) =>
        findPlaceholders(readFileSync(join(app, f), "utf8")).map((p) => `${f}: ${p}`),
      );
    expect(left).toEqual([]);
  });

  it("app.config.ts sets the ids the plugin never sets, and configures the shell plugin", async () => {
    const { io } = fakeIO(cwd);
    await main(["app", ...rocketCrewFlags], io);
    const config = readFileSync(join(cwd, "app/app.config.ts"), "utf8");
    expect(config).toContain('bundleIdentifier: "tv.rocketcrew.app"');
    expect(config).toContain('appleTeamId: "34S957HD77"');
    expect(config).toContain('package: "tv.rocketcrew.app"');
    expect(config).toContain('appId: "rocket-crew"');
    expect(config).toContain('name: "Rocket Crew"');
    expect(config).toContain('gameUrl: "https://rocketcrew.tv/phone"');
    expect(config).toContain('branding: "hidden"');
    expect(config).toContain('linkDomains: ["rocketcrew.tv"]');
    expect(config).toContain('cast: { receiver: "ogs" }');
    expect(config).toContain('plugins: ["expo-router", ["@open-game-system/shell", shell]]');
    expect(config).toMatch(/backgroundColor: "#[0-9a-f]{6}"/);
  });

  it("the screens render <OgsShell /> from the shell package", async () => {
    const { io } = fakeIO(cwd);
    await main(["app", ...rocketCrewFlags], io);
    const index = readFileSync(join(cwd, "app/app/index.tsx"), "utf8");
    expect(index).toContain('import { OgsShell } from "@open-game-system/shell";');
    expect(index).toContain("<OgsShell />");
    expect(readFileSync(join(cwd, "app/app/_layout.tsx"), "utf8")).toContain("<Stack");
    expect(readFileSync(join(cwd, "app/app/+native-intent.ts"), "utf8")).toContain(
      "redirectSystemPath",
    );
  });

  it("package.json uses exactly the OGS app's Expo SDK versions, plus the shell", async () => {
    const { io } = fakeIO(cwd);
    await main(["app", ...rocketCrewFlags, "--shell-version", "^0.3.0"], io);
    const pkg = readPackageJson(join(cwd, "app/package.json"));
    const mobile = readPackageJson(join(REPO_ROOT, "apps/mobile/package.json"));
    const mobileAll = { ...mobile.dependencies, ...mobile.devDependencies };
    expect(pkg.name).toBe("rocket-crew-app");
    expect(pkg.main).toBe("expo-router/entry");
    expect(pkg.dependencies["@open-game-system/shell"]).toBe("^0.3.0");
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const differ = Object.entries(all).filter(
      ([name, version]) => name in mobileAll && mobileAll[name] !== version,
    );
    expect(differ).toEqual([]);
    for (const name of ["expo", "react", "react-native", "react-native-webview", "expo-router"]) {
      expect(all[name], name).toBe(mobileAll[name]);
    }
    const notInMobile = Object.keys(all).filter((name) => !(name in mobileAll));
    expect(notInMobile.sort()).toEqual(["@open-game-system/shell", "expo-apple-authentication"]);
    expect(pkg.dependencies["expo-apple-authentication"]).toMatch(/^~55\./);
  });

  it("package.json has every peer the shell needs (once packages/shell exists)", {
    skip: !existsSync(join(REPO_ROOT, "packages/shell/package.json")),
  }, async () => {
    const { io } = fakeIO(cwd);
    await main(["app", ...rocketCrewFlags], io);
    const pkg = readPackageJson(join(cwd, "app/package.json"));
    const shell = readPackageJson(join(REPO_ROOT, "packages/shell/package.json"));
    const missing = Object.keys(shell.peerDependencies).filter(
      (name) => !(name in pkg.dependencies) && !(name in pkg.devDependencies),
    );
    expect(missing).toEqual([]);
  });

  it("eas.json: development, preview for TestFlight, production; no secrets", async () => {
    const { io } = fakeIO(cwd);
    await main(["app", ...rocketCrewFlags], io);
    const text = readFileSync(join(cwd, "app/eas.json"), "utf8");
    const eas = z
      .object({
        build: z.object({
          development: z.object({ developmentClient: z.literal(true) }),
          preview: z.object({ distribution: z.literal("store"), autoIncrement: z.literal(true) }),
          production: z.object({ distribution: z.literal("store") }),
        }),
        submit: z.object({
          preview: z.object({ ios: z.object({ appleTeamId: z.literal("34S957HD77") }) }),
          production: z.object({}),
        }),
      })
      .safeParse(z.unknown().parse(JSON.parse(text)));
    expect(eas.error?.issues ?? []).toEqual([]);
    expect(text).not.toMatch(/password|BEGIN PRIVATE KEY|ascApiKeyId|appleId"/i);
  });

  it("link files name the app for the developer's own domain", async () => {
    const { io } = fakeIO(cwd);
    await main(["app", ...rocketCrewFlags], io);
    const read = (f: string): unknown =>
      JSON.parse(readFileSync(join(cwd, "app/link-files/.well-known", f), "utf8"));
    const aasa = z
      .object({
        applinks: z.object({ details: z.array(z.object({ appIDs: z.array(z.string()) })) }),
      })
      .parse(read("apple-app-site-association"));
    expect(aasa.applinks.details.map((d) => d.appIDs)).toEqual([["34S957HD77.tv.rocketcrew.app"]]);
    const assetlinks = z
      .array(z.object({ target: z.object({ package_name: z.string() }) }))
      .parse(read("assetlinks.json"));
    expect(assetlinks.map((a) => a.target.package_name)).toEqual(["tv.rocketcrew.app"]);
  });

  it("without a link domain: no link files, links via opengame.org", async () => {
    const { io, out } = fakeIO(cwd);
    expect(await main(["app", ...rocketCrewFlags, "--no-link-domain"], io)).toBe(0);
    expect(existsSync(join(cwd, "app/link-files"))).toBe(false);
    expect(readFileSync(join(cwd, "app/app.config.ts"), "utf8")).toContain("linkDomains: []");
    expect(readFileSync(join(cwd, "app/examples/server/send-push-link.ts"), "utf8")).toContain(
      '"https://opengame.org/play/rocket-crew"',
    );
    expect(out.join("\n")).toContain("opengame.org/play/rocket-crew");
  });

  it("the icons are PNGs", async () => {
    const { io } = fakeIO(cwd);
    await main(["app", ...rocketCrewFlags], io);
    for (const icon of ["icon", "adaptive-icon", "splash-icon"]) {
      const png = readFileSync(join(cwd, `app/assets/${icon}.png`));
      expect(png.subarray(1, 4).toString("ascii"), icon).toBe("PNG");
    }
  });

  it("asks for what isn't given", async () => {
    const { io } = fakeIO(cwd, [
      "my-app",
      "rocket-crew",
      "",
      "https://rocketcrew.tv/phone",
      "",
      "",
      "34S957HD77",
      "-",
      "powered-by",
    ]);
    expect(await main([], io)).toBe(0);
    const config = readFileSync(join(cwd, "my-app/app.config.ts"), "utf8");
    expect(config).toContain('branding: "powered-by"');
    expect(config).toContain("linkDomains: []");
  });

  it("writes into an empty directory that exists", async () => {
    mkdirSync(join(cwd, "app"));
    const { io } = fakeIO(cwd);
    expect(await main(["app", ...rocketCrewFlags], io)).toBe(0);
    expect(existsSync(join(cwd, "app/app.config.ts"))).toBe(true);
  });

  it("refuses a directory with files in it, and touches nothing", async () => {
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app/keep.txt"), "mine");
    const { io, err } = fakeIO(cwd);
    expect(await main(["app", ...rocketCrewFlags], io)).toBe(1);
    expect(err.join("\n")).toMatch(/not empty/);
    expect(walk(join(cwd, "app"))).toEqual(["keep.txt"]);
  });

  it("--help prints the usage and writes nothing", async () => {
    const { io, out } = fakeIO(cwd);
    expect(await main(["--help"], io)).toBe(0);
    expect(out.join("\n")).toContain("pnpm create ogs-app");
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("bad flags exit 2 with the reason", async () => {
    const { io, err } = fakeIO(cwd);
    expect(await main(["--bogus"], io)).toBe(2);
    expect(err.join("\n")).toMatch(/--bogus/);
    const missing = fakeIO(cwd);
    expect(await main(["--yes", "--app-id", "rocket-crew"], missing.io)).toBe(2);
    expect(missing.err.join("\n")).toMatch(/--game-url/);
    expect(readdirSync(cwd)).toEqual([]);
  });
});
