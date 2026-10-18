// The OGS shell config plugin. `@open-game-system/shell/plugin` is the pure core plus the Expo plugins;
// `app.plugin.js` loads the default export (withOgsShell).
import { withOgsShell } from "./with-ogs-shell";

export { mergeNativeConfig, type NativeConfigPart } from "./merge-native-config";
export {
  type IntentFilter,
  type NativeConfig,
  nativeConfigFor,
  OGS_CAST_RECEIVER_APP_ID,
  OGS_LINK_HOST,
  type PluginEntry,
} from "./native-config";
export {
  parseShellConfig,
  type ShellConfig,
  type ShellConfigInput,
  ShellConfigSchema,
} from "./shell-config";
export {
  type ApplyPlugins,
  createShellPlugins,
  SHELL_PLUGIN_NAME,
  withOgsShell,
  withShellCast,
  withShellLinks,
  withShellPush,
  withShellSignIn,
} from "./with-ogs-shell";

export default withOgsShell;
