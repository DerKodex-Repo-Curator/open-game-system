import { realpathSync } from "node:fs";
import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

/** ogs-protocol runs from its source (as in packages/profile-kit/vitest.config.ts). */
const src = (pkg: string, file = "src/index.ts") =>
  path.join(realpathSync(path.resolve(__dirname, "node_modules/@open-game-system", pkg)), file);

/** Unit and in-process tests; the browser e2e (test/*.e2e.test.ts) runs with vitest.e2e.config.ts. */
export default defineConfig({
  resolve: {
    alias: { "@open-game-system/ogs-protocol": src("ogs-protocol") },
  },
  test: { exclude: [...configDefaults.exclude, "test/**/*.e2e.test.ts"] },
});
