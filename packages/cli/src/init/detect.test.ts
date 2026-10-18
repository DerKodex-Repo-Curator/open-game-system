import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { files } from "../io";
import { detectFramework, detectPackageManager, installCommand } from "./detect";

let root: string;
const fs = () =>
  files({
    env: {},
    stdout: () => {},
    stderr: () => {},
    readFile: (p) => readFileSync(p, "utf8"),
    fetch,
    cwd: () => root,
  });
const put = (path: string, content = "") => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};
const pkg = (body: object) => put("package.json", JSON.stringify(body));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ogs-detect-"));
});

describe("the package manager", () => {
  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["package-lock.json", "npm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
  ])("%s means %s", (lockfile, pm) => {
    put(lockfile);
    expect(detectPackageManager(fs(), root)).toEqual({ pm, from: lockfile });
  });

  it("package.json's packageManager wins over a lockfile", () => {
    put("package-lock.json");
    pkg({ packageManager: "pnpm@9.15.9" });
    expect(detectPackageManager(fs(), root)).toEqual({ pm: "pnpm", from: "packageManager" });
  });

  it("no lockfile: npm, and says so", () => {
    expect(detectPackageManager(fs(), root)).toEqual({ pm: "npm", from: null });
  });

  it("the install command for each", () => {
    expect(installCommand("pnpm")).toBe("pnpm install");
    expect(installCommand("npm")).toBe("npm install");
    expect(installCommand("yarn")).toBe("yarn install");
    expect(installCommand("bun")).toBe("bun install");
  });
});

describe("the framework", () => {
  it("vite in devDependencies is Vite", () => {
    pkg({ devDependencies: { vite: "^7" } });
    expect(detectFramework(fs(), root)).toBe("vite");
  });
  it("a vite.config.ts is Vite", () => {
    put("vite.config.ts");
    expect(detectFramework(fs(), root)).toBe("vite");
  });
  it("next is Next (even with vite around)", () => {
    pkg({ dependencies: { next: "15" }, devDependencies: { vite: "^7" } });
    expect(detectFramework(fs(), root)).toBe("next");
  });
  it("a next.config.mjs is Next", () => {
    put("next.config.mjs");
    expect(detectFramework(fs(), root)).toBe("next");
  });
  it("@tanstack/react-start is TanStack Start (it runs on Vite)", () => {
    pkg({ dependencies: { "@tanstack/react-start": "1" }, devDependencies: { vite: "^7" } });
    expect(detectFramework(fs(), root)).toBe("tanstack-start");
  });
  it("anything else is plain", () => {
    put("index.html", "<html>");
    expect(detectFramework(fs(), root)).toBe("plain");
  });
});
