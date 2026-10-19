/**
 * True inside __OGS_APP_NAME__'s own app (built with @open-game-system/shell): its WebView adds
 * `OgsShell/__OGS_APP_ID__` to the user agent. False in a plain browser and inside the OGS app.
 */
export function inOwnApp(userAgent: string = globalThis.navigator?.userAgent ?? ""): boolean {
  return userAgent.includes("OgsShell/__OGS_APP_ID__");
}
