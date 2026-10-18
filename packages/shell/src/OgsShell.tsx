import Constants from "expo-constants";
import { useEffect, useReducer, useState, useSyncExternalStore } from "react";
import { AppState, Linking, StyleSheet, Text, View } from "react-native";
import { defaultShellDeps } from "./default-deps";
import { DEFAULT_OFFLINE_THEME, OfflineScreen, type OfflineTheme } from "./OfflineScreen";
import { type OgsShellConfig, readRuntimeConfig } from "./runtime-config";
import { ShellWebView } from "./ShellWebView";
import { SignInSheet } from "./SignInSheet";
import { createShellRuntime, type ShellRuntime, type ShellRuntimeDeps } from "./shell-runtime";
import type { AppleAuthModule } from "./sign-in-providers";
import {
  type AppStateLike,
  INITIAL_WEBVIEW_STATUS,
  watchForeground,
  webViewStatus,
} from "./webview-status";

/** The slice of React Native's Linking this needs. */
export interface LinkingLike {
  getInitialURL(): Promise<string | null>;
  addEventListener(type: "url", listener: (event: { url: string }) => void): { remove(): void };
}

export interface OgsShellProps {
  /** Default: the plugin's `extra.ogsShell` from Constants.expoConfig. */
  config?: OgsShellConfig;
  /** Default: createShellRuntime(config, defaultShellDeps() + deps). */
  runtime?: ShellRuntime;
  /** Overrides for the default dependencies (e.g. the game's cast/profile/notifications stores). */
  deps?: Partial<ShellRuntimeDeps>;
  theme?: Partial<OfflineTheme>;
  /** `import * as AppleAuthentication from "expo-apple-authentication"` (optional peer). */
  appleAuthentication?: AppleAuthModule;
  linking?: LinkingLike;
  appState?: AppStateLike;
}

/**
 * A single-game app: the game's phone page full screen in a bridged WebView, the native offline
 * screen, the native sign-in sheet when the game asks, links routed into the page. "Powered by
 * OGS" (branding: powered-by) shows on the loading and offline screens, never over the game.
 */
export function OgsShell(props: OgsShellProps) {
  const [config] = useState(() => props.config ?? readRuntimeConfig(Constants.expoConfig));
  const [runtime] = useState(
    () =>
      props.runtime ??
      createShellRuntime(config, {
        ...defaultShellDeps(config, { appleAuthentication: props.appleAuthentication }),
        ...props.deps,
      }),
  );
  const linking = props.linking ?? Linking;
  const appState = props.appState ?? AppState;
  const [status, dispatch] = useReducer(webViewStatus, INITIAL_WEBVIEW_STATUS);
  const [uri, setUri] = useState(config.gameUrl);
  const sheet = useSyncExternalStore(runtime.sheet.subscribe, runtime.sheet.getSnapshot);
  const theme: OfflineTheme = { ...DEFAULT_OFFLINE_THEME, ...props.theme };

  useEffect(() => {
    void runtime.start();
    return () => runtime.stop();
  }, [runtime]);

  useEffect(() => watchForeground(appState, () => dispatch({ type: "FOREGROUND" })), [appState]);

  useEffect(() => {
    let live = true;
    const open = (url: string | null) => {
      const target = url ? runtime.webViewUrlFor(url) : null;
      if (!live || !target) return;
      setUri(target);
      dispatch({ type: "RETRY" });
    };
    linking.getInitialURL().then(open, () => {});
    const sub = linking.addEventListener("url", ({ url }) => open(url));
    return () => {
      live = false;
      sub.remove();
    };
  }, [linking, runtime]);

  const powered = config.branding === "powered-by" ? <PoweredBy color={theme.muted} /> : null;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]} testID="ogsShell">
      {status.phase === "offline" ? (
        <View style={styles.fill}>
          <OfflineScreen
            gameName={config.name}
            theme={theme}
            onRetry={() => dispatch({ type: "RETRY" })}
          />
          {powered}
        </View>
      ) : (
        <ShellWebView
          bridge={runtime.bridge}
          uri={uri}
          attempt={status.attempt}
          onStatus={dispatch}
        />
      )}
      {status.phase === "loading" ? (
        <View
          style={[StyleSheet.absoluteFill, styles.loading, { backgroundColor: theme.background }]}
          testID="shellLoading"
          pointerEvents="none"
        >
          <Text style={[styles.loadingName, { color: theme.text }]}>{config.name}</Text>
          {powered}
        </View>
      ) : null}
      <SignInSheet
        visible={sheet.visible}
        gameName={config.name}
        providers={sheet.providers}
        state={sheet.signIn}
        onSignIn={(p) => void runtime.signInWith(p)}
        onClose={() => runtime.closeSignIn()}
      />
    </View>
  );
}

function PoweredBy({ color }: { color: string }) {
  return (
    <Text style={[styles.powered, { color }]} testID="poweredByOgs">
      Powered by OGS
    </Text>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  loading: { alignItems: "center", justifyContent: "center" },
  loadingName: { fontSize: 24, fontWeight: "700" },
  powered: { position: "absolute", bottom: 40, alignSelf: "center", fontSize: 12 },
});
