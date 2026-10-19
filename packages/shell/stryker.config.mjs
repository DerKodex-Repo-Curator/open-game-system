/**
 * Mutation testing for packages/shell/src (the runtime modules).
 *
 * Most modules moved from apps/mobile/services and are tested there through one-line shims, so the
 * tests that kill their mutants are apps/mobile's (jest.mutation.config.js runs them, plus src/__tests__).
 * `inPlace`: apps/mobile resolves "@open-game-system/shell/modules/*" to this package's real src,
 * never to a sandbox copy. Stryker restores the files when it ends; don't commit during a run.
 *
 * Run from packages/shell: `pnpm test:mutate` (all of src) or
 * `pnpm test:mutate --mutate src/cast-store.ts` for one module. Incremental: a rerun only tests
 * mutants whose code or tests changed (reports/stryker-incremental.json).
 * Stryker and its jest runner come from the workspace root (hoisted from apps/mobile's devDependencies).
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  plugins: ["@stryker-mutator/jest-runner"],
  packageManager: "pnpm",
  testRunner: "jest",
  jest: { configFile: "jest.mutation.config.js", enableFindRelatedTests: false },
  coverageAnalysis: "perTest",
  inPlace: true,
  // Babel strips types, nothing type-checks: leave the files as they are apart from the mutants.
  disableTypeChecks: false,
  mutate: ["src/**/*.ts", "!src/**/__tests__/**", "!src/index.ts"],
  // Each runner runs all of apps/mobile's suites in one process for the dry run.
  concurrency: 6,
  dryRunTimeoutMinutes: 30,
  // Generous: one apps/mobile suite can take 30 s to load on a busy machine.
  timeoutMS: 60000,
  timeoutFactor: 3,
  reporters: ["html", "json", "clear-text", "progress"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  htmlReporter: { fileName: "reports/mutation/index.html" },
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",
  thresholds: { high: 90, low: 70, break: null },
  warnings: { unknownOptions: false },
};
