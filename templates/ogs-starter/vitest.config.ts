import { defineConfig } from "vitest/config";

/** Unit tests. The seam tests have their own config (vitest.seam.config.ts): they start wrangler. */
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
