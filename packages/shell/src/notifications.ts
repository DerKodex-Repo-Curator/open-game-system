import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * Decides a foreground push: show the banner, or hand it to the open game's page (spec §9). Set by
 * the runtime; until then every push shows.
 */
export type ForegroundGate = (n: Notifications.Notification) => boolean;
let foregroundGate: ForegroundGate = () => true;
export function setForegroundGate(gate: ForegroundGate) {
  foregroundGate = gate;
}

// Configure how notifications are displayed when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const show = foregroundGate(notification);
    return {
      shouldShowAlert: show,
      shouldPlaySound: show,
      shouldSetBadge: false,
      shouldShowBanner: show,
      shouldShowList: show,
    };
  },
});

/** Granted already, or granted when asked now. */
export async function pushPermissionGranted(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

const easProjectId = (): string | undefined =>
  Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

/** Android shows nothing without a channel. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#FF231F7C",
  });
}

/**
 * Requests notification permissions and returns the push token.
 * Returns null if permissions are denied or the device doesn't support push.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  // Push notifications only work on physical devices
  if (!Device.isDevice) {
    console.log("[Notifications] Push notifications are not supported on simulator/emulator");
    return null;
  }

  if (!(await pushPermissionGranted())) {
    console.log("[Notifications] Permission denied");
    return null;
  }

  // Get the Expo push token
  const projectId = easProjectId();
  if (!projectId) {
    console.error("[Notifications] No EAS project ID found");
    return null;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  console.log("[Notifications] Push token:", tokenData.data);

  await ensureAndroidChannel();
  return tokenData.data;
}

/**
 * Registers this device's push token with the OGS API (`apiBase`, the app's configured API) under
 * the profile's device id, which is how OGS finds a profile's phones (profile_devices).
 */
export async function registerDeviceWithAPI(
  apiBase: string,
  ogsDeviceId: string,
  pushToken: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${apiBase}/api/v1/devices/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ogsDeviceId,
        platform: Platform.OS as "ios" | "android",
        pushToken,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("[Notifications] Device registration failed:", error);
      return false;
    }

    const data = await response.json();
    console.log("[Notifications] Device registered:", data);
    return true;
  } catch (error) {
    console.error("[Notifications] Device registration error:", error);
    return false;
  }
}

/**
 * Full initialization for the profile's device: request permission, get the push token, register it
 * with the API. Returns the token, or null when there is none (denied, a simulator).
 */
export async function initializePushNotifications(
  apiBase: string,
  deviceId: string,
): Promise<string | null> {
  console.log("[Notifications] Device ID:", deviceId);
  const pushToken = await registerForPushNotifications();
  if (pushToken) await registerDeviceWithAPI(apiBase, deviceId, pushToken);
  return pushToken;
}

/**
 * Listener for push token changes. Call this to keep the API in sync
 * when the OS rotates the push token.
 */
export function addPushTokenListener(apiBase: string, deviceId: string) {
  return Notifications.addPushTokenListener(async (token) => {
    console.log("[Notifications] Push token changed:", token.data);
    await registerDeviceWithAPI(apiBase, deviceId, token.data);
  });
}

/**
 * Extract the game URL from a notification's data payload.
 */
export function getGameUrlFromNotification(
  notification: Notifications.Notification,
): string | null {
  const data = notification.request.content.data;
  return (data?.url as string) ?? null;
}
