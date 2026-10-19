import type {
  AccountBridgeEvent,
  AccountBridgeState,
  ProfileLogin,
} from "@open-game-system/ogs-protocol";

export type { AccountBridgeEvent, AccountBridgeState, ProfileLogin };

/** The `account` app-bridge store a game's own app (OGS shell) gives its WebView. */
export type AccountStores = {
  account: { state: AccountBridgeState; events: AccountBridgeEvent };
};

/** What sign-in needs of an app bridge (app-bridge-web's createWebBridge, or a mock). */
export interface AccountBridge {
  isSupported(): boolean;
  getStore(key: "account"): { dispatch(event: AccountBridgeEvent): void } | undefined;
}

/**
 * Asks the game's own app to show its native sign-in sheet (call it from a tap, for example on a
 * guest's "Sign in" button). True when the app took it; false where there is no `account` store: a
 * plain browser, or the OGS app (which signs players in itself).
 */
export function requestSignIn(bridge: AccountBridge): boolean {
  if (!bridge.isSupported()) return false;
  const store = bridge.getStore("account");
  if (!store) return false;
  store.dispatch({ type: "SIGN_IN" });
  return true;
}
