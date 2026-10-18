import * as AppleAuthentication from "expo-apple-authentication";
import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createDeviceSource } from "./device";
import { expoHapticsPlayer } from "./expo-haptics-player";
import { apnsEnvironmentFromEntitlement } from "./native-push";
import type { ShellRuntimeDeps } from "./shell-runtime";
import { appleSignIn, unavailableSignIn } from "./sign-in-providers";

/**
 * The runtime's dependencies on a real device. Sign in with Apple on iOS; Google is not wired yet
 * (unavailable on both platforms in v1 of the runtime).
 */
export function defaultShellDeps(): ShellRuntimeDeps {
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
      Platform.OS === "ios"
        ? appleSignIn(AppleAuthentication, () => Crypto.randomUUID())
        : unavailableSignIn("apple"),
      unavailableSignIn("google"),
    ],
  };
}
