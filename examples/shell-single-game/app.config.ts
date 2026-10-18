import type { ShellConfigInput } from "@open-game-system/shell/plugin";
import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * The fixture's shell config: what a game developer writes. __tests__/introspect.test.ts checks the
 * native config the plugin derives from it (`expo config --type introspect`), without a prebuild.
 */
export const shell = {
  appId: "example-game",
  name: "Example Game",
  gameUrl: "https://example.com/phone",
  branding: "powered-by",
  linkDomains: ["example.com"],
  cast: { receiver: "ogs" },
} satisfies ShellConfigInput;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: shell.name,
  slug: shell.appId,
  scheme: shell.appId,
  version: "1.0.0",
  orientation: "default",
  userInterfaceStyle: "automatic",
  // The developer's identity: the plugin never sets or changes these.
  ios: { bundleIdentifier: "com.example.game", supportsTablet: true },
  android: { package: "com.example.game" },
  plugins: ["expo-router", ["@open-game-system/shell", shell]],
});
