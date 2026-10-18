import { defineConfig } from "tsdown";

// Games install cast-kit-react from a packed tarball: cast-kit-core and the app bridge are not on
// npm at these versions, so bundle them in and keep only react, zod and fast-json-patch outside.
export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm", "cjs"],
  dts: { resolver: "tsc" },
  clean: true,
  inputOptions: { resolve: { mainFields: ["module", "main"] } },
  deps: {
    alwaysBundle: [/^@open-game-system\//],
    neverBundle: ["react", "zod", "fast-json-patch"],
  },
});
