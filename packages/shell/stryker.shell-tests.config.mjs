import { createRequire } from "node:module";
import base from "./stryker.config.mjs";

/**
 * Mutation testing for the shell modules apps/mobile never imports (the runtime added on top of
 * the moved modules: shell-runtime, links, sign-in, push, haptics, the single-game cast store…).
 * Only `src/__tests__` tests them, so this runs the shell's own jest config in a sandbox instead of
 * loading apps/mobile's 90 suites in place: minutes instead of an hour, and it can run alongside an
 * in-place run of stryker.config.mjs once its sandbox is copied.
 *
 * Run from packages/shell:
 * `pnpm exec stryker run stryker.shell-tests.config.mjs --mutate src/<module>.ts,src/<other>.ts`.
 * Never use it for a module apps/mobile imports through a shim (its kills come from apps/mobile).
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
const require = createRequire(import.meta.url);
// Stryker wraps the test environment before Jest applies the preset: name jest-expo's (docs/lessons.md).
const { testEnvironment } = require(require.resolve("jest-expo/jest-preset"));

export default {
  ...base,
  jest: {
    configFile: "jest.config.js",
    enableFindRelatedTests: false,
    config: { testEnvironment },
  },
  inPlace: false,
  concurrency: 4,
  dryRunTimeoutMinutes: 10,
  timeoutMS: 20000,
  jsonReporter: { fileName: "reports/mutation-shell/mutation.json" },
  htmlReporter: { fileName: "reports/mutation-shell/index.html" },
  incrementalFile: "reports/stryker-shell-incremental.json",
};
