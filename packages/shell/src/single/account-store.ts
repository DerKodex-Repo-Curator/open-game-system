import { createStore } from "@open-game-system/app-bridge-native";
import type { Store } from "@open-game-system/app-bridge-types";
import { AccountBridgeEventSchema, type AccountBridgeState } from "@open-game-system/ogs-protocol";
import type { UntrustedEvent } from "./haptics-store";

export type AccountStores = { account: { state: AccountBridgeState; events: UntrustedEvent } };

type Internal =
  | { type: "LOGIN"; login: AccountBridgeState["login"] }
  | { type: "SIGNING_IN"; on: boolean };

/**
 * The `account` app-bridge store (single-game apps): the page sees how this device is signed in
 * and sends SIGN_IN to open the shell's native sign-in sheet.
 */
export function createAccountStore(opts: { requestSignIn: () => void }) {
  const inner = createStore<AccountBridgeState, Internal>({
    initialState: { login: "none", signingIn: false },
    producer: (draft, event) => {
      if (event.type === "LOGIN") draft.login = event.login;
      else draft.signingIn = event.on;
    },
  });
  const store: Store<AccountBridgeState, UntrustedEvent> = {
    getSnapshot: () => inner.getSnapshot(),
    subscribe: (listener) => inner.subscribe(listener),
    reset: () => inner.reset(),
    on: () => () => {},
    dispatch(event) {
      if (AccountBridgeEventSchema.safeParse(event).success) opts.requestSignIn();
    },
  };
  return {
    store,
    setLogin: (login: AccountBridgeState["login"]) => inner.dispatch({ type: "LOGIN", login }),
    setSigningIn: (on: boolean) => inner.dispatch({ type: "SIGNING_IN", on }),
  };
}
