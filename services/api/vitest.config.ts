import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["node_modules", "container/**", "test/e2e/**", "test/integration/**"],
    // Most files start a workerd-backed local D1 in beforeAll (test/support/d1.ts); on a loaded
    // machine that took over the 10 s default and skipped whole files without a single assertion
    // failing (2026-10-18, load average ~280).
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      // Mock cloudflare:workers for Vitest (only available in Workers runtime)
      "cloudflare:workers": path.resolve(__dirname, "test/__mocks__/cloudflare-workers.ts"),
    },
  },
});
