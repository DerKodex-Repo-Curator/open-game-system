const path = require("node:path");

// Jest config for mutation testing the shell's runtime (stryker.config.mjs). Most of src moved from
// apps/mobile/services, whose suites still test it through one-line shims, so this is apps/mobile's
// own jest config with the shell's src/__tests__ added (one project: Stryker's jest runner flattens
// `projects`).
//
// apps/mobile's tests read app.json and package.json from the cwd, and Babel roots its config search
// at the cwd (rooted here it would apply this package's babel.config.js to apps/mobile). Stryker must
// run from packages/shell (it only mutates files under its cwd), so its jest worker, which loads this
// file and then runs every test in the same process, moves to apps/mobile.
const mobileDir = path.resolve(__dirname, "../../apps/mobile");
process.chdir(mobileDir);

const { collectCoverageFrom: _appCoverage, ...mobileJest } = require(
  path.join(mobileDir, "package.json"),
).jest;

// Stryker wraps the test environment before Jest applies the preset, so name jest-expo's environment
// here; left to Stryker it becomes plain node, without the react-native export condition, and the
// shell would load from build/ instead of src.
const { testEnvironment } = require(
  require.resolve("jest-expo/jest-preset", { paths: [mobileDir] }),
);

/** @type {import('jest').Config} */
module.exports = {
  ...mobileJest,
  rootDir: mobileDir,
  testEnvironment,
  roots: [mobileDir, path.join(__dirname, "src")],
};
