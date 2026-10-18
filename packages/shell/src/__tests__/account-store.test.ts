import type { AccountBridgeState } from "@open-game-system/ogs-protocol";
import { createAccountStore } from "../account-store";

describe("account bridge store", () => {
  it("starts with no profile, not signing in", () => {
    const { store } = createAccountStore({ requestSignIn: () => {} });
    expect(store.getSnapshot()).toEqual({ login: "none", signingIn: false });
  });

  it("asks the shell for its sign-in sheet on SIGN_IN", () => {
    const requestSignIn = jest.fn();
    const { store } = createAccountStore({ requestSignIn });
    store.dispatch({ type: "SIGN_IN" });
    expect(requestSignIn).toHaveBeenCalledTimes(1);
  });

  it("ignores events that don't parse", () => {
    const requestSignIn = jest.fn();
    const { store } = createAccountStore({ requestSignIn });
    store.dispatch({ type: "SIGN_OUT" });
    store.dispatch({ type: "sign_in" });
    expect(requestSignIn).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toEqual({ login: "none", signingIn: false });
  });

  it("tells the page the login and whether a sign-in is under way", () => {
    const account = createAccountStore({ requestSignIn: () => {} });
    const seen: AccountBridgeState[] = [];
    account.store.subscribe((s) => seen.push(s));
    account.setLogin("guest");
    account.setSigningIn(true);
    account.setLogin("apple");
    account.setSigningIn(false);
    account.setSigningIn(false);
    expect(seen).toEqual([
      { login: "none", signingIn: false },
      { login: "guest", signingIn: false },
      { login: "guest", signingIn: true },
      { login: "apple", signingIn: true },
      { login: "apple", signingIn: false },
    ]);
  });

  it("reset returns to the start; on() hears nothing (events are parsed in dispatch)", () => {
    const account = createAccountStore({ requestSignIn: () => {} });
    account.setLogin("guest");
    account.store.reset();
    expect(account.store.getSnapshot()).toEqual({ login: "none", signingIn: false });
    expect(typeof account.store.on("SIGN_IN", () => {})).toBe("function");
  });
});
