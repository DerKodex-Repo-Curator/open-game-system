// @open-game-system/shell runtime. Each module is also importable on its own as
// "@open-game-system/shell/modules/<name>" (one module instance either way); apps/mobile imports them
// that way through one-line shims in apps/mobile/services.
// Add new modules in alphabetical order (biome sorts exports). Modules with import-time side effects
// (notifications: setNotificationHandler) are NOT re-exported here; import them by module path.

export * from "./api-request";
export * from "./cast-backend";
export * from "./cast-once";
export * from "./cast-session-device";
export * from "./cast-store";
export * from "./cast-sync";
export * from "./cast-trace";
export * from "./cast-view";
export * from "./client-log";
export * from "./consent-sheet";
export * from "./fake-cast";
export * from "./game-loading";
export * from "./game-notifications";
export * from "./game-profile";
export * from "./game-url-store";
export * from "./google-cast-backend";
export * from "./hardware-back";
export * from "./identity";
export * from "./js-errors";
export * from "./ogs-bridge";
export * from "./push-api";
export * from "./push-foreground";
export * from "./push-registration";
export * from "./screen-cast";

// --- Single-game app runtime (src/single) ---
// The WebView, <OgsShell /> and the device defaults (native modules, app-bridge-react-native) are in
// "@open-game-system/shell/app", so importing this entry loads no WebView.
export { createAccountStore } from "./single/account-store";
export { createShellRequest, ShellApiError } from "./single/api-client";
export { castLauncherUrl } from "./single/cast-launcher-url";
export { createDeviceSource } from "./single/device";
export { expoHapticsPlayer } from "./single/expo-haptics-player";
export { createGuestApi, ensureGuestProfile, type ShellDevice } from "./single/guest-profile";
export { createHapticsStore, type HapticsPlayer } from "./single/haptics-store";
export { loadIdentity, type ShellIdentity, saveIdentity } from "./single/identity";
export {
  apnsEnvironmentFromEntitlement,
  createNativePush,
  type PushRegistration,
} from "./single/native-push";
export {
  createNativeAuthApi,
  createNativeSignIn,
  type NativeSignInProvider,
  type SignInState,
} from "./single/native-sign-in";
export { DEFAULT_OFFLINE_THEME, OfflineScreen, type OfflineTheme } from "./single/OfflineScreen";
export { DEFAULT_OGS_API, type OgsShellConfig, readRuntimeConfig } from "./single/runtime-config";
export { SignInSheet } from "./single/SignInSheet";
export { webViewUrlFor } from "./single/shell-links";
export {
  createShellRuntime,
  type ShellContext,
  type ShellRuntime,
  type ShellRuntimeDeps,
} from "./single/shell-runtime";
export { appleSignIn, unavailableSignIn } from "./single/sign-in-providers";
export { createSingleGameCastStore, type SingleGameCastOptions } from "./single/single-cast";
export { watchForeground, webViewStatus } from "./single/webview-status";
