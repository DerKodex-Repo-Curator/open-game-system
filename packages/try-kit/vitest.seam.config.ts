import { defineConfig } from "vitest/config";

/** Seam tests: the fixture game (test/fixture) under wrangler dev, over real HTTP and WebSockets. */
export default defineConfig({
  test: {
    include: ["test/**/*.seam.test.ts"],
    globalSetup: ["test/fixture/serve.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
