import path from "node:path";
import type { ExpoConfig } from "expo/config";
import { describe, expect, it, vi } from "vitest";
import type { PluginEntry } from "../native-config";
import {
  createShellPlugins,
  withOgsShell,
  withShellCast,
  withShellLinks,
  withShellPush,
  withShellSignIn,
} from "../with-ogs-shell";

const props = {
  appId: "rocket-crew",
  gameUrl: "https://rocketcrew.tv/play",
  name: "Rocket Crew",
  linkDomains: ["rocketcrew.tv"],
};
const bare: ExpoConfig = { name: "Rocket Crew", slug: "rocket-crew" };

/** Records what would be applied, and marks it in the plugin history like Expo's run-once plugins. */
function recordingApplier() {
  const applied: PluginEntry[] = [];
  const applyPlugins = vi.fn((config: ExpoConfig, plugins: PluginEntry[]): ExpoConfig => {
    applied.push(...plugins);
    if (plugins.length === 0) return config;
    const history = { ...config._internal?.pluginHistory };
    for (const plugin of plugins) {
      const name = typeof plugin === "string" ? plugin : plugin[0];
      history[name] = { name, version: "test" };
    }
    return { ...config, _internal: { ...config._internal, pluginHistory: history } };
  });
  return { applied, applyPlugins };
}

describe("withOgsShell (injected plugin applier)", () => {
  it("writes the native config and applies the cast, push, sign-in and splash plugins", () => {
    const { applied, applyPlugins } = recordingApplier();
    const config = createShellPlugins(applyPlugins).withOgsShell(bare, props);
    expect(config.ios?.associatedDomains).toEqual([
      "applinks:rocketcrew.tv",
      "applinks:opengame.org",
    ]);
    expect(config.ios?.usesAppleSignIn).toBe(true);
    expect(config.android?.intentFilters).toHaveLength(2);
    expect(config.extra?.ogsShell).toEqual({
      appId: "rocket-crew",
      gameUrl: "https://rocketcrew.tv/play",
      branding: "hidden",
      linkDomains: ["rocketcrew.tv"],
    });
    expect(applied).toEqual([
      [
        "react-native-google-cast",
        { receiverAppId: "807AD5E9", iosStartDiscoveryAfterFirstTapOnCastButton: false },
      ],
      "expo-notifications",
      "expo-apple-authentication",
      "expo-splash-screen",
    ]);
  });

  it("running twice changes nothing more and applies each plugin once", () => {
    const { applied, applyPlugins } = recordingApplier();
    const plugins = createShellPlugins(applyPlugins);
    const once = plugins.withOgsShell(bare, props);
    const twice = plugins.withOgsShell(once, props);
    expect(twice).toEqual(once);
    expect(applied).toHaveLength(4);
  });

  it("rejects bad props, naming the plugin", () => {
    const { applyPlugins } = recordingApplier();
    expect(() =>
      createShellPlugins(applyPlugins).withOgsShell(bare, { ...props, gameUrl: "http://x.tv" }),
    ).toThrow("@open-game-system/shell");
    expect(applyPlugins).not.toHaveBeenCalled();
  });

  it("withShellLinks writes only the links", () => {
    const { applyPlugins } = recordingApplier();
    const config = createShellPlugins(applyPlugins).withShellLinks(bare, props);
    expect(config).toEqual({
      ...bare,
      ios: { associatedDomains: ["applinks:rocketcrew.tv", "applinks:opengame.org"] },
      android: { intentFilters: expect.any(Array) },
    });
    expect(applyPlugins).toHaveBeenCalledWith(expect.anything(), []);
  });

  it("withShellCast writes the local network text, Bonjour and the cast plugin", () => {
    const { applied, applyPlugins } = recordingApplier();
    const config = createShellPlugins(applyPlugins).withShellCast(bare, props);
    expect(Object.keys(config.ios?.infoPlist ?? {})).toEqual([
      "NSLocalNetworkUsageDescription",
      "NSBonjourServices",
    ]);
    expect(applied.map((p) => (typeof p === "string" ? p : p[0]))).toEqual([
      "react-native-google-cast",
    ]);
  });

  it("withShellPush applies expo-notifications only", () => {
    const { applied, applyPlugins } = recordingApplier();
    const config = createShellPlugins(applyPlugins).withShellPush(bare, props);
    expect(config.ios).toBeUndefined();
    expect(applied).toEqual(["expo-notifications"]);
  });

  it("withShellSignIn enables Sign in with Apple", () => {
    const { applied, applyPlugins } = recordingApplier();
    const config = createShellPlugins(applyPlugins).withShellSignIn(bare, props);
    expect(config.ios).toEqual({ usesAppleSignIn: true });
    expect(applied).toEqual(["expo-apple-authentication"]);
  });
});

describe("withOgsShell (Expo's own withPlugins)", () => {
  // expo-apple-authentication is the app's dependency (create-ogs-app installs it); this package
  // doesn't install it, so the fixture lists it as the template does.
  const app: ExpoConfig = {
    ...bare,
    plugins: ["expo-apple-authentication"],
    _internal: { projectRoot: path.resolve(__dirname, "../../..") },
  };

  // Loading the real plugins (and @expo/config-plugins) takes seconds on a cold start.
  it("applies the real plugins once, and the whole shell once (run-once)", {
    timeout: 30_000,
  }, () => {
    const once = withOgsShell(app, props);
    const history = once._internal?.pluginHistory ?? {};
    expect(Object.keys(history)).toEqual(
      expect.arrayContaining([
        "@open-game-system/shell",
        "expo-notifications",
        "expo-splash-screen",
      ]),
    );
    expect(once.ios?.associatedDomains).toContain("applinks:opengame.org");
    expect(withOgsShell(once, props)).toEqual(once);
  });

  it("the exported sub-plugins are the real ones", () => {
    for (const plugin of [withShellLinks, withShellCast, withShellPush, withShellSignIn]) {
      expect(typeof plugin).toBe("function");
    }
  });
});
