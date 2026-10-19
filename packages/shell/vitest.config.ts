import { defineConfig } from "vitest/config";

// Vitest runs the config plugin's pure core (plugin/src) and the packed-tarball check (test/); the
// React Native runtime (src) runs under jest-expo.
export default defineConfig({
  test: { environment: "node", include: ["plugin/src/**/*.test.ts", "test/**/*.test.ts"] },
});
