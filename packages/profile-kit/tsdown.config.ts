import { defineConfig } from "tsdown";

// Games install profile-kit from a packed tarball (like cast-kit), and ogs-protocol and the app
// bridge are not on npm at these versions: bundle them in, keep only zod / fast-json-patch / react
// outside.
export default defineConfig({
  entry: ["src/index.ts", "src/react.tsx", "src/server.ts"],
  format: ["esm", "cjs"],
  dts: { resolver: "tsc" },
  clean: true,
  // app-bridge-web has main (cjs) + module (esm) and no exports map: prefer its ESM build, or the
  // inlined CJS pulls `node:module` (createRequire) into the browser bundle.
  inputOptions: { resolve: { mainFields: ["module", "main"] } },
  deps: {
    alwaysBundle: [/^@open-game-system\//],
    neverBundle: ["react", "zod", "fast-json-patch"],
  },
});
