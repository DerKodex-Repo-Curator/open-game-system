import "../services/log-guard-install";
import "../services/e2e-clock-install";
import { useFonts } from "expo-font";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";
import { useEffect } from "react";
import { AppErrorBoundary } from "../components/ogs/AppErrorBoundary";
import { colors } from "../components/ogs/theme";
import { UpdateRequired } from "../components/ogs/UpdateRequired";
import {
  addPushTokenListener,
  getGameUrlFromNotification,
  initializePushNotifications,
} from "../services/notifications";
import { isOnboardingComplete } from "../services/onboarding";
import { open } from "../services/open-link";
import { startPushRegistration } from "../services/push-registration";
import { appState, config, jsErrors } from "../services/runtime";
import { incrementSessionCount } from "../services/session-counter";
import { openUpdate, useUpdateGate } from "../services/update-check";

export default function RootLayout() {
  const updateGate = useUpdateGate();
  const [fontsLoaded] = useFonts({
    "Fraunces-Display": require("../assets/fonts/Fraunces-Display.ttf"),
  });

  // Push setup once onboarding is done (the index route decides where the app opens): this phone
  // registers under its OGS profile's device id, as soon as the profile exists.
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    void (async () => {
      if (!(await isOnboardingComplete()) || cancelled) return;
      await incrementSessionCount();
      stop = startPushRegistration({
        deviceId: () => appState.getSnapshot().identity?.deviceId ?? null,
        subscribe: (listener) => appState.subscribe(listener),
        register: (deviceId) => initializePushNotifications(config.apiBase, deviceId),
        listen: (deviceId) => addPushTokenListener(config.apiBase, deviceId),
      });
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  // Deep link subscription (event listener).
  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      if (url) open(url, "link");
    });
    const sub = Linking.addEventListener("url", (event) => open(event.url, "link"));
    return () => sub.remove();
  }, []);

  // Notification taps (event listener).
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = getGameUrlFromNotification(response.notification);
      if (url) open(url, "push");
    });
    return () => sub.remove();
  }, []);

  if (!fontsLoaded) return null;

  // An older build than the latest beta: nothing else until it is updated.
  if (updateGate.kind === "update") {
    return <UpdateRequired onUpdate={() => openUpdate(updateGate.url)} />;
  }

  return (
    <AppErrorBoundary onError={(error) => jsErrors.boundary(error, "root")}>
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.dusk0 } }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        <Stack.Screen name="(tabs)" />
        {/* The game screen has its own left-edge swipe (it sends home); the native one would skip it. */}
        <Stack.Screen
          name="game"
          options={{ gestureEnabled: false, animation: "slide_from_right" }}
        />
        <Stack.Screen name="game-detail" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="sign-in" options={{ presentation: "modal" }} />
        <Stack.Screen name="edit-profile" options={{ presentation: "modal" }} />
        <Stack.Screen name="invite-friends" options={{ presentation: "modal" }} />
        <Stack.Screen name="play/[appId]" />
        <Stack.Screen name="join/[code]" />
        <Stack.Screen name="dev-tools" />
        <Stack.Screen name="[...unmatched]" />
      </Stack>
    </AppErrorBoundary>
  );
}
