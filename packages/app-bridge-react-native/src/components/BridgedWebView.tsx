import type { BridgeStores, NativeBridge } from "@open-game-system/app-bridge-types";
import React from "react";
import type { WebViewProps } from "react-native-webview";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

/**
 * Props for BridgedWebView component
 * Extends standard WebViewProps to allow passing any valid prop.
 */
export interface BridgedWebViewProps<TStores extends BridgeStores>
  extends Omit<WebViewProps, "onMessage" | "source" | "ref"> {
  /**
   * The NativeBridge instance to use for communication
   */
  bridge: NativeBridge<TStores>;

  /**
   * Optional custom message handler for WebView messages
   * This will be called *after* the bridge processes the message
   */
  onMessage?: (event: WebViewMessageEvent) => void;

  /**
   * The source of the WebView (required)
   */
  source: WebViewProps["source"];
}

/** A script that fires `message` (data: the message) on the page's window. */
export function windowMessage(message: string): string {
  // JSON.stringify makes a JS string literal; U+2028/U+2029 escaped for older JS engines.
  const literal = JSON.stringify(message)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `window.dispatchEvent(new MessageEvent("message", { data: ${literal} }));true;`;
}

/**
 * A WebView component that automatically handles bridge registration and message handling
 */
export function BridgedWebView<TStores extends BridgeStores>({
  bridge,
  onMessage,
  source,
  ...rest
}: BridgedWebViewProps<TStores>) {
  const webViewRef = React.useRef<WebView>(null);
  // What the bridge posts to: each message fired on the page's `window` (not react-native-webview's
  // postMessage, which Android fires on `document`, where the web bridge never hears it).
  const pageTarget = React.useMemo(
    () => ({
      postMessage: (message: string) =>
        webViewRef.current?.injectJavaScript(windowMessage(message)),
    }),
    [],
  );

  // Register/unregister WebView with the bridge
  React.useEffect(() => {
    if (webViewRef.current) {
      bridge.registerWebView(pageTarget);
    }
  }, [bridge, pageTarget]);

  // Create a message handler that processes bridge messages and calls custom handler
  const handleMessage = React.useCallback(
    (event: WebViewMessageEvent) => {
      // Handle bridge message processing
      bridge.handleWebMessage(event.nativeEvent.data);

      // Call custom handler if provided
      onMessage?.(event);
    },
    [bridge, onMessage],
  );

  return <WebView ref={webViewRef} source={source} onMessage={handleMessage} {...rest} />;
}
