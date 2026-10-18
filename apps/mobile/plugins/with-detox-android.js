// Detox on Android (e2e on an emulator), only when the prebuild runs with DETOX_ANDROID=1: any other
// prebuild (EAS, CI releases) gets the config unchanged. The published @config-plugins/detox
// supports Expo up to 53; this does the same few things for this app:
// - the Detox AAR's local Maven repo and the test runner (android/build.gradle, app/build.gradle);
// - androidTest/.../DetoxTest.java (the instrumentation Detox drives);
// - cleartext to the host machine (10.0.2.2, localhost) for local stacks over http.
const fs = require("node:fs");
const path = require("node:path");
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withProjectBuildGradle,
} = require("expo/config-plugins");

const DETOX_REPO = 'maven { url("$rootDir/../node_modules/detox/Detox-android") }';

function withDetoxAndroid(config) {
  if (process.env.DETOX_ANDROID !== "1") return config;

  config = withProjectBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes("Detox-android"))
      c.modResults.contents = c.modResults.contents.replace(
        /allprojects\s*\{\s*repositories\s*\{/,
        (m) => `${m}\n    ${DETOX_REPO}`,
      );
    return c;
  });

  config = withAppBuildGradle(config, (c) => {
    let g = c.modResults.contents;
    if (!g.includes("testBuildType"))
      g = g.replace(
        /defaultConfig\s*\{/,
        (m) =>
          `${m}\n        testBuildType System.getProperty('testBuildType', 'debug')\n        testInstrumentationRunner 'androidx.test.runner.AndroidJUnitRunner'`,
      );
    if (!g.includes("com.wix:detox"))
      g = g.replace(
        /dependencies\s*\{/,
        (m) =>
          `${m}\n    androidTestImplementation('com.wix:detox:+')\n    androidTestImplementation('junit:junit:4.13.2')`,
      );
    c.modResults.contents = g;
    return c;
  });

  config = withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (app) app.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    return c;
  });

  return withDangerousMod(config, [
    "android",
    (c) => {
      const pkg = c.android?.package ?? "org.opengame.app";
      const root = c.modRequest.platformProjectRoot;
      const xml = path.join(root, "app/src/main/res/xml");
      fs.mkdirSync(xml, { recursive: true });
      fs.writeFileSync(
        path.join(xml, "network_security_config.xml"),
        `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">10.0.2.2</domain>
    <domain includeSubdomains="true">localhost</domain>
  </domain-config>
</network-security-config>
`,
      );
      const dir = path.join(root, "app/src/androidTest/java", ...pkg.split("."));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "DetoxTest.java"),
        `package ${pkg};

import com.wix.detox.Detox;
import com.wix.detox.config.DetoxConfig;

import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.LargeTest;
import androidx.test.rule.ActivityTestRule;

@RunWith(AndroidJUnit4.class)
@LargeTest
public class DetoxTest {
    @Rule
    public ActivityTestRule<MainActivity> mActivityRule = new ActivityTestRule<>(MainActivity.class, false, false);

    @Test
    public void runDetoxTests() {
        DetoxConfig detoxConfig = new DetoxConfig();
        detoxConfig.idlePolicyConfig.masterTimeoutSec = 90;
        detoxConfig.idlePolicyConfig.idleResourceTimeoutSec = 60;
        detoxConfig.rnContextLoadTimeoutSec = 180;
        Detox.runTests(mActivityRule, detoxConfig);
    }
}
`,
      );
      return c;
    },
  ]);
}

module.exports = withDetoxAndroid;
