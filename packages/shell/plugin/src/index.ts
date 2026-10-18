// The OGS shell config plugin. `@open-game-system/shell/plugin` is the pure core plus the Expo plugin;
// `app.plugin.js` loads the default export.
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
