// The Detox test wiring for Android (plugins/with-detox-android.js) only in a Detox build
// (DETOX_ANDROID=1 at prebuild): store builds, EAS builds and the native fingerprint never see it.
module.exports = ({ config }) =>
  process.env.DETOX_ANDROID === "1"
    ? { ...config, plugins: [...(config.plugins ?? []), "./plugins/with-detox-android"] }
    : config;
