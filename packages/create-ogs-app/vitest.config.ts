import { defineConfig } from "vitest/config";

export default defineConfig({
  // The integration tests write whole apps and run the built bin: give a busy machine room.
  test: { include: ["src/**/*.test.ts", "test/**/*.test.ts"], testTimeout: 30_000 },
});
