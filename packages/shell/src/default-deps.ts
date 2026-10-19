import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { castGameStores } from "./cast-stores";
import { streamServerUrl } from "./cast-view";
import { askToNotify } from "./consent-sheet";
import { createDeviceSource } from "./device";
import { expoHapticsPlayer } from "./expo-haptics-player";
import { ogsGameStores } from "./game-stores";
import { createGoogleCastBackend } from "./google-cast-backend";
import { apnsEnvironmentFromEntitlement } from "./native-push";
import type { ShellRuntimeConfig, ShellRuntimeDeps } from "./shell-runtime";
import { type AppleAuthModule, appleSignIn, unavailableSignIn } from "./sign-in-providers";

/**
 * The runtime's dependencies on a real device: Google Cast (the game's `cast` store), SecureStore,
 * expo-notifications, expo-haptics. Sign in with Apple on iOS when the app passes
 * expo-apple-authentication in; Google is not wired yet
 * (unavailable on both platforms in v1 of the runtime).
 */
export function defaultShellDeps(
  config: ShellRuntimeConfig,
  options: {
    /**
     * `import * as AppleAuthentication from "expo-apple-authentication"` (an optional peer: the
     * shell never imports it). Without it, Sign in with Apple is not offered.
     */
    appleAuthentication?: AppleAuthModule;
  } = {},
): ShellRuntimeDeps {
  const apple = options.appleAuthentication;
  const storage = SecureStore;
  return {
    fetch: (url, init) => fetch(url, init),
    storage,
    device: createDeviceSource({
      storage,
      mintId: () => Crypto.randomUUID(),
      kind: () => (Device.deviceType === Device.DeviceType.TABLET ? "tablet" : "phone"),
      name: () => Device.deviceName ?? Device.modelName,
    }),
    notifications: Notifications,
    platform: Platform.OS === "android" ? "android" : "ios",
    apnsEnvironment: async () =>
      apnsEnvironmentFromEntitlement(
        await Application.getIosPushNotificationServiceEnvironmentAsync(),
      ),
    haptics: expoHapticsPlayer(),
    signInProviders: [
      Platform.OS === "ios" && apple
        ? appleSignIn(apple, () => Crypto.randomUUID())
        : unavailableSignIn("apple"),
      unavailableSignIn("google"),
    ],
    // The Google Cast backend is made when the runtime asks for the stores, not here.
    gameStores: (ctx) => ({
      ...castGameStores(createGoogleCastBackend(), {
        streamServerUrl: streamServerUrl({}, config.apiBase),
        browserTvStorage: AsyncStorage,
      })(ctx),
      ...ogsGameStores({ askPlayer: askToNotify })(ctx),
    }),
  };
}
