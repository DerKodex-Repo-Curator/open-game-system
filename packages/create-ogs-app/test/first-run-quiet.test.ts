import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * The first `pnpm install` and `pnpm ios` of a new app print nothing that looks like a problem the
 * developer caused, and change none of its files.
 */
const TEMPLATE = resolve(__dirname, "../template");
const read = (f: string) => readFileSync(join(TEMPLATE, f), "utf8");

const PackageJson = z.object({ dependencies: z.record(z.string()) });
const deps = PackageJson.parse(JSON.parse(read("package.json"))).dependencies;

describe("the template's first run is quiet", () => {
  it("pins react-dom to react's version (expo-router's web deps want it; else an unmet peer)", () => {
    expect(deps["react-dom"]).toBe(deps.react);
  });

  it("has expo-system-ui, which userInterfaceStyle needs on Android (else prebuild warns)", () => {
    expect(read("app.config.ts")).toContain('userInterfaceStyle: "automatic"');
    expect(deps["expo-system-ui"]).toMatch(/^~55\./);
  });

  it("tsconfig includes what Expo keeps (no typed routes): Expo doesn't rewrite it on first run", () => {
    const tsconfig = z
      .object({ include: z.array(z.string()) })
      .parse(JSON.parse(read("tsconfig.json")));
    expect(tsconfig.include).toEqual(["app", "app.config.ts"]);
  });
});
