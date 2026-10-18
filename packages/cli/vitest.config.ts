import { configDefaults, defineConfig } from "vitest/config";

/** Unit and in-process tests; the browser e2e (test/*.e2e.test.ts) runs with vitest.e2e.config.ts. */
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "test/**/*.e2e.test.ts"] },
});
