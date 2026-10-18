import { defineConfig } from "tsdown";

// Games install try-kit from a packed tarball (like profile-kit): ESM only (Workers and bundlers).
export default defineConfig({
  entry: ["src/index.ts", "src/worker.ts", "src/browser.ts", "src/load.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  deps: { neverBundle: ["qrcode-generator"] },
});
