import { realpathSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * What Stryker runs: the unit tests plus the integration suite in Node (Stryker's vitest runner
 * cannot reach workerd). `cloudflare:test` is test/node/cloudflare-test.ts (D1 on node:sqlite,
 * SELF = the Hono app). Suites that need Durable Objects or the OIDC emulators, and friends (in
 * flux), stay workerd-only (vitest.integration.config.mts).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/*.test.ts", "test/integration/**/*.test.ts"],
    exclude: [
      "test/integration/auth.test.ts",
      "test/integration/couch.test.ts",
      "test/integration/friends*.test.ts",
    ],
    setupFiles: ["./test/integration/setup.ts"],
  },
  resolve: {
    alias: [
      {
        find: "cloudflare:workers",
        replacement: path.resolve(__dirname, "test/__mocks__/cloudflare-workers.ts"),
      },
      {
        find: "cloudflare:test",
        replacement: path.resolve(__dirname, "test/node/cloudflare-test.ts"),
      },
      // The unit tests' wrangler-proxy D1 starts workerd per file: node:sqlite here (same SQL).
      {
        find: /^\.\/support\/d1$/,
        replacement: path.resolve(__dirname, "test/node/support-d1.ts"),
      },
      // The shell's plain-TypeScript modules run from source (as in vitest.config.ts).
      {
        find: "@open-game-system/shell/modules",
        replacement: path.join(
          realpathSync(path.resolve(__dirname, "node_modules/@open-game-system/shell")),
          "src",
        ),
      },
    ],
  },
});
