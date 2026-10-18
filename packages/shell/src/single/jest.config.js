// TEMPORARY local config until claude/shell-app's packages/shell scaffold lands (then removed).
/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  rootDir: __dirname,
  transformIgnorePatterns: [
    "node_modules/(?!(.pnpm|((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|react-native-google-cast|@open-game-system/.*|immer|fast-json-patch))",
  ],
};
