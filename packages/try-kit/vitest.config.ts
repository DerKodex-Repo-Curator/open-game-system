import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], exclude: ["test/**/*.seam.test.ts", "node_modules"], environment: "node" },
});
