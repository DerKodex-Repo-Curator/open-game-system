import type { ExpoConfig } from "expo/config";
import { type ConfigPlugin, createRunOncePlugin, withPlugins } from "expo/config-plugins";
import { mergeNativeConfig, type NativeConfigPart } from "./merge-native-config";
import { type NativeConfig, nativeConfigFor, type PluginEntry } from "./native-config";
import { parseShellConfig } from "./shell-config";

export const SHELL_PLUGIN_NAME = "@open-game-system/shell";

/** Applies config plugins (Expo's withPlugins in an app; a recorder in tests). */
export type ApplyPlugins = (config: ExpoConfig, plugins: PluginEntry[]) => ExpoConfig;

const parts = {
  links: (n: NativeConfig): NativeConfigPart => ({
    ios: { associatedDomains: n.ios.associatedDomains },
    android: n.android,
  }),
  cast: (n: NativeConfig): NativeConfigPart => ({
    ios: { infoPlist: n.ios.infoPlist },
    plugins: n.plugins.filter(
      (p) => (typeof p === "string" ? p : p[0]) === "react-native-google-cast",
    ),
  }),
  push: (): NativeConfigPart => ({ plugins: ["expo-notifications"] }),
  signIn: (n: NativeConfig): NativeConfigPart => ({
    ios: { usesAppleSignIn: n.ios.usesAppleSignIn },
    plugins: ["expo-apple-authentication"],
  }),
  all: (n: NativeConfig): NativeConfigPart => n,
};

/** The shell's config plugins over a plugin applier. Each parses its props (the shell config). */
export function createShellPlugins(applyPlugins: ApplyPlugins) {
  const partPlugin =
    (pick: (native: NativeConfig) => NativeConfigPart): ConfigPlugin<unknown> =>
    (config, props) => {
      const part = pick(nativeConfigFor(parseShellConfig(props)));
      const { config: merged, pendingPlugins } = mergeNativeConfig(config, part);
      return applyPlugins(merged, pendingPlugins);
    };
  return {
    withShellLinks: partPlugin(parts.links),
    withShellCast: partPlugin(parts.cast),
    withShellPush: partPlugin(parts.push),
    withShellSignIn: partPlugin(parts.signIn),
    withOgsShell: partPlugin(parts.all),
  };
}

const expoPlugins = createShellPlugins((config, plugins) => withPlugins(config, plugins));

export const withShellLinks = expoPlugins.withShellLinks;
export const withShellCast = expoPlugins.withShellCast;
export const withShellPush = expoPlugins.withShellPush;
export const withShellSignIn = expoPlugins.withShellSignIn;
/** `plugins: [["@open-game-system/shell", shellConfig]]`: everything, once per config. */
export const withOgsShell: ConfigPlugin<unknown> = createRunOncePlugin(
  expoPlugins.withOgsShell,
  SHELL_PLUGIN_NAME,
);
