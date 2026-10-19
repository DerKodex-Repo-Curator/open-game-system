import type { ExpoConfig } from "expo/config";
import { describe, expect, it } from "vitest";
import { mergeNativeConfig } from "../merge-native-config";
import { nativeConfigFor } from "../native-config";
import { ShellConfigSchema } from "../shell-config";

// docs/acceptance/2026-10-18-white-label-shell.feature, "Running the plugin twice changes nothing more".
const native = nativeConfigFor(
  ShellConfigSchema.parse({
    appId: "rocket-crew",
    gameUrl: "https://rocketcrew.tv/play",
    name: "Rocket Crew",
    icon: "./assets/icon.png",
    linkDomains: ["rocketcrew.tv"],
  }),
);

const bare: ExpoConfig = { name: "Rocket Crew", slug: "rocket-crew" };

describe("mergeNativeConfig", () => {
  it("writes the whole native config into a bare app config", () => {
    const { config, pendingPlugins } = mergeNativeConfig(bare, native);
    expect(config).toEqual({
      name: "Rocket Crew",
      slug: "rocket-crew",
      icon: "./assets/icon.png",
      ios: native.ios,
      android: native.android,
      extra: native.extra,
    });
    expect(pendingPlugins).toEqual(native.plugins);
  });

  it("adds to what the app already has, once, and keeps the app's own permission text", () => {
    const existing: ExpoConfig = {
      ...bare,
      ios: {
        bundleIdentifier: "tv.rocketcrew.app",
        associatedDomains: ["applinks:opengame.org", "applinks:other.example"],
        infoPlist: {
          ITSAppUsesNonExemptEncryption: false,
          NSLocalNetworkUsageDescription: "Our own words.",
          NSBonjourServices: ["_googlecast._tcp", "_other._tcp"],
        },
      },
      android: {
        package: "tv.rocketcrew.app",
        intentFilters: [native.android.intentFilters[1]],
      },
      plugins: [
        "expo-router",
        ["react-native-google-cast", { receiverAppId: "807AD5E9" }],
        "expo-apple-authentication",
      ],
      extra: { eas: { projectId: "p" } },
    };
    const { config, pendingPlugins } = mergeNativeConfig(existing, native);
    expect(config.ios).toEqual({
      bundleIdentifier: "tv.rocketcrew.app",
      associatedDomains: [
        "applinks:opengame.org",
        "applinks:other.example",
        "applinks:rocketcrew.tv",
      ],
      usesAppleSignIn: true,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSLocalNetworkUsageDescription: "Our own words.",
        NSBonjourServices: ["_googlecast._tcp", "_other._tcp"],
      },
    });
    expect(config.android).toEqual({
      package: "tv.rocketcrew.app",
      intentFilters: [native.android.intentFilters[1], native.android.intentFilters[0]],
    });
    expect(config.plugins).toEqual(existing.plugins);
    expect(config.extra).toEqual({ eas: { projectId: "p" }, ...native.extra });
    expect(pendingPlugins).toEqual(["expo-notifications", "expo-splash-screen"]);
  });

  it("skips plugins Expo already ran (run-once plugin history)", () => {
    const ran: ExpoConfig = {
      ...bare,
      _internal: {
        pluginHistory: {
          "expo-notifications": { name: "expo-notifications", version: "55.0.27" },
        },
      },
    };
    expect(mergeNativeConfig(ran, native).pendingPlugins).not.toContain("expo-notifications");
  });

  it("an intent filter with the same content in another key order is the same filter", () => {
    const [own] = native.android.intentFilters;
    const reordered = {
      category: own.category,
      data: own.data,
      autoVerify: own.autoVerify,
      action: own.action,
    };
    const { config } = mergeNativeConfig(
      { ...bare, android: { intentFilters: [reordered] } },
      { android: { intentFilters: [own] } },
    );
    expect(config.android?.intentFilters).toHaveLength(1);
  });

  it("is idempotent", () => {
    const once = mergeNativeConfig(bare, native).config;
    const twice = mergeNativeConfig(once, native).config;
    expect(twice).toEqual(once);
  });

  it("never sets the developer's identity", () => {
    const { config } = mergeNativeConfig(bare, native);
    expect(config.ios?.bundleIdentifier).toBeUndefined();
    expect(config.ios?.appleTeamId).toBeUndefined();
    expect(config.android?.package).toBeUndefined();
    expect(config.owner).toBeUndefined();
  });

  it("does not change its input", () => {
    const input: ExpoConfig = { ...bare, ios: { associatedDomains: ["applinks:a.example"] } };
    const snapshot = JSON.parse(JSON.stringify(input));
    mergeNativeConfig(input, native);
    expect(input).toEqual(snapshot);
  });

  it("merges a part (a sub-plugin's slice) without touching the rest", () => {
    const { config, pendingPlugins } = mergeNativeConfig(bare, { plugins: ["expo-notifications"] });
    expect(config).toEqual(bare);
    expect(pendingPlugins).toEqual(["expo-notifications"]);
  });
});
