import { defineConfig } from "vitest/config";

/** `ogs dev` end to end: the built CLI, a fixture game and Chromium (pnpm test:e2e; builds first). */
export default defineConfig({
  test: {
    include: ["test/**/*.e2e.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
