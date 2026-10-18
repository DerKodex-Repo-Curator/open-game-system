import { BridgedWebView } from "@open-game-system/app-bridge-react-native";
import type { BridgeStores, NativeBridge } from "@open-game-system/app-bridge-types";
import { StyleSheet, View } from "react-native";
import type { WebViewStatusEvent } from "./webview-status";

export interface ShellWebViewProps<TStores extends BridgeStores> {
  /** The app bridge with the shell's stores (cast, profile, notifications, ogs, haptics…). */
  bridge: NativeBridge<TStores>;
  uri: string;
  /** From webViewStatus: a new attempt mounts a fresh WebView (retry). */
  attempt: number;
  onStatus: (event: WebViewStatusEvent) => void;
  onNavigate?: (url: string) => void;
  /** Appended to the WebView's user agent (OgsShell/<appId>: see shellUserAgentName). */
  userAgentName?: string;
}

/** The game's page: app-bridge's BridgedWebView with the settings games rely on. */
export function ShellWebView<TStores extends BridgeStores>({
  bridge,
  uri,
  attempt,
  onStatus,
  onNavigate,
  userAgentName,
}: ShellWebViewProps<TStores>) {
  return (
    <View style={styles.container} testID="gameWebView">
      <BridgedWebView
        key={attempt}
        bridge={bridge}
        source={{ uri }}
        applicationNameForUserAgent={userAgentName}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={false}
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        onLoad={() => onStatus({ type: "LOADED" })}
        onError={() => onStatus({ type: "FAILED" })}
        onHttpError={(e) => {
          if (e.nativeEvent.statusCode >= 500) onStatus({ type: "FAILED" });
        }}
        onNavigationStateChange={(nav) => onNavigate?.(nav.url)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1, backgroundColor: "transparent" },
});
