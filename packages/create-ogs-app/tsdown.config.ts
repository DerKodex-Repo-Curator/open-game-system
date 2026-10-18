import { defineConfig } from "tsdown";

// One ESM file for the bin (`create-ogs-app`); the template ships next to dist/ as plain files.
export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  dts: false,
  clean: true,
  deps: { neverBundle: ["zod"] },
});
