/**
 * What the game's WebView adds to its user agent (react-native-webview's
 * applicationNameForUserAgent): `OgsShell/<appId>`. A page checks
 * `navigator.userAgent.includes("OgsShell/<its appId>")` to know it is running in its own app
 * (built with @open-game-system/shell), not in a plain browser or inside the OGS app.
 */
export function shellUserAgentName(appId: string): string {
  return `OgsShell/${appId}`;
}
