import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["src/**/*.test.ts"], environment: "node" } },
      {
        test: {
          name: "seam",
          include: ["e2e/**/*.seam.test.ts"],
          globalSetup: ["e2e/global-setup.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
