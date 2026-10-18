import { defineConfig } from "vitest/config";

// Vitest runs only the config plugin's pure core (plugin/src); the React Native runtime (src) runs under jest-expo.
export default defineConfig({
  test: { environment: "node", include: ["plugin/src/**/*.test.ts"] },
});
