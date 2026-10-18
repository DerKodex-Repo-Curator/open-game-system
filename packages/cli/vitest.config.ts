import { realpathSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

/** ogs-protocol runs from its source (as in packages/profile-kit/vitest.config.ts). */
const src = (pkg: string, file = "src/index.ts") =>
  path.join(realpathSync(path.resolve(__dirname, "node_modules/@open-game-system", pkg)), file);

export default defineConfig({
  resolve: {
    alias: { "@open-game-system/ogs-protocol": src("ogs-protocol") },
  },
});
