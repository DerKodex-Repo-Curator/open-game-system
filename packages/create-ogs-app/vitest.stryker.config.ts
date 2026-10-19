import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

// Mutation runs skip the built-bin / tarball test: it rebuilds dist and packs on every run.
export default mergeConfig(
  base,
  defineConfig({ test: { exclude: ["test/bin.test.ts", "**/node_modules/**"] } }),
);
