import { defineConfig } from "tsdown";

// ogs-protocol (ManifestSchema, for ogs init and manifest checks) is not on npm: bundle it in, like
// profile-kit does (packages/profile-kit/tsdown.config.ts). zod stays a dependency.
export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts"],
  format: ["esm"],
  dts: { resolve: [/^@open-game-system\//] },
  clean: true,
  platform: "node",
  deps: {
    alwaysBundle: [/^@open-game-system\//],
    neverBundle: ["zod"],
  },
});
