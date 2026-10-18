import { defineConfig } from "vitest/config";

// `expo config --type introspect` evaluates the config plugins (no prebuild): a few seconds per run.
export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
