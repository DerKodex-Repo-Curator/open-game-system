import { defineConfig } from "tsdown";

// Games install cast-kit from a packed tarball (like profile-kit), and the app bridge is not on npm
// at this version: bundle it in, keep only zod and fast-json-patch outside.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: { resolver: "tsc" },
  clean: true,
  // app-bridge-web has main (cjs) + module (esm) and no exports map: prefer its ESM build, or the
  // inlined CJS pulls `node:module` (createRequire) into the browser bundle.
  inputOptions: { resolve: { mainFields: ["module", "main"] } },
  deps: {
    alwaysBundle: [/^@open-game-system\//],
    neverBundle: ["zod", "fast-json-patch"],
  },
});
