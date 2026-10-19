import type { ExpoConfig } from "expo/config";
import type { ShellConfig } from "./shell-config";

/**
 * The app's custom URL scheme (`<scheme>://play/<rest>` links open in the game): the shell
 * config's `scheme`, else the appId, unless the app already has its own. Pure.
 */
export function withAppScheme(config: ExpoConfig, shell: ShellConfig): ExpoConfig {
  const own = [config.scheme ?? []].flat().filter((s) => s !== "");
  if (own.length > 0) return config;
  return { ...config, scheme: shell.scheme ?? shell.appId };
}
