import { realpathSync } from "node:fs";
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
      // The shell's plain-TypeScript modules (client-log, js-errors) run from source, as the other
      // packages' tests run ogs-protocol: its build/ is React Native output the API never builds.
      "@open-game-system/shell/modules": path.join(
        realpathSync(path.resolve(__dirname, "node_modules/@open-game-system/shell")),
        "src",
      ),
    },
  },
});
