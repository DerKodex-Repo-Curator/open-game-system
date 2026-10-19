import { describe, expect, it } from "vitest";
import { missingTargets, packageJsonTargets } from "./packed-paths";

describe("packageJsonTargets", () => {
  it("collects main, module, types, react-native, source, bin and every exports leaf", () => {
    expect(
      packageJsonTargets({
        name: "x",
        main: "dist/index.cjs",
        module: "./dist/index.mjs",
        types: "./dist/index.d.mts",
        "react-native": "src/index.ts",
        source: "src/index.ts",
        bin: { x: "./dist/bin.mjs" },
        exports: {
          "./package.json": "./package.json",
          ".": {
            "react-native": "./src/index.ts",
            import: { types: "./dist/a.d.mts", default: "./dist/a.mjs" },
          },
          "./modules/*": { default: "./build/*.js" },
        },
      }).targets,
    ).toEqual([
      "build/",
      "dist/a.d.mts",
      "dist/a.mjs",
      "dist/bin.mjs",
      "dist/index.cjs",
      "dist/index.d.mts",
      "dist/index.mjs",
      "src/index.ts",
    ]);
  });

  it("reads a react-native map and a string bin", () => {
    expect(
      packageJsonTargets({
        name: "x",
        "react-native": { "./a.js": "./a.native.js", fs: false },
        bin: "cli.js",
      }).targets,
    ).toEqual(["a.native.js", "cli.js"]);
  });
});

describe("missingTargets", () => {
  it("names files not in the tarball, and directories with nothing under them", () => {
    expect(
      missingTargets(["dist/a.js", "src/index.ts", "build/"], ["dist/a.js", "package.json"]),
    ).toEqual(["src/index.ts", "build/"]);
    expect(missingTargets(["build/"], ["build/x.js"])).toEqual([]);
  });
});
