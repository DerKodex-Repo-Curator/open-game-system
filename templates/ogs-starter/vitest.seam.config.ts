import { defineConfig } from "vitest/config";

/** Seam tests: the real Worker (wrangler dev, started by the global setup) driven by Playwright. */
export default defineConfig({
  test: {
    include: ["e2e/**/*.seam.test.ts"],
    globalSetup: ["e2e/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
