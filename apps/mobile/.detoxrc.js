/** @type {import('detox').DetoxConfig} */
module.exports = {
  logger: {
    level: process.env.CI ? "debug" : "info",
  },
  testRunner: {
    args: {
      config: "e2e/jest.config.js",
      maxWorkers: 1,
      _: ["e2e"],
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  apps: {
    "ios.release": {
      type: "ios.app",
      // DETOX_IOS_BINARY: a Release .app built elsewhere (each agent its own derived data).
      binaryPath:
        process.env.DETOX_IOS_BINARY ??
        "ios/build/Build/Products/Release-iphonesimulator/opengameapp.app",
      build:
        "xcodebuild -workspace ios/opengameapp.xcworkspace -scheme opengameapp -configuration Release -sdk iphonesimulator -derivedDataPath ios/build -quiet",
    },
    // Android: a release APK and its test APK, built after `DETOX_ANDROID=1 expo prebuild -p android`
    // (plugins/with-detox-android.js adds the Detox instrumentation). DETOX_ANDROID_DIR: a build
    // elsewhere (each agent its own output).
    "android.release": {
      type: "android.apk",
      binaryPath:
        process.env.DETOX_ANDROID_APK ?? "android/app/build/outputs/apk/release/app-release.apk",
      testBinaryPath:
        process.env.DETOX_ANDROID_TEST_APK ??
        "android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk",
      build:
        "cd android && ./gradlew :app:assembleRelease :app:assembleAndroidTest -DtestBuildType=release && cd ..",
    },
    "ios.debug": {
      type: "ios.app",
      binaryPath: "ios/build/Build/Products/Debug-iphonesimulator/opengameapp.app",
      build:
        "xcodebuild -workspace ios/opengameapp.xcworkspace -scheme opengameapp -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build -quiet",
    },
  },
  devices: {
    emulator: {
      type: "android.emulator",
      // DETOX_AVD_NAME: an emulator of your own.
      device: { avdName: process.env.DETOX_AVD_NAME ?? "ogs_pixel_35" },
    },
    simulator: {
      type: "ios.simulator",
      // DETOX_SIM_NAME: run on a named simulator of your own (never someone else's).
      device: process.env.DETOX_SIM_NAME
        ? { name: process.env.DETOX_SIM_NAME }
        : { type: "iPhone 16" },
    },
  },
  configurations: {
    "android.emu.release": {
      device: "emulator",
      app: "android.release",
    },
    "ios.sim.release": {
      device: "simulator",
      app: "ios.release",
    },
    "ios.sim.debug": {
      device: "simulator",
      app: "ios.debug",
    },
  },
};
