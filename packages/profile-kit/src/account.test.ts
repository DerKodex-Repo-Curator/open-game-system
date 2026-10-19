import { createMockBridge } from "@open-game-system/app-bridge-testing";
import { describe, expect, it } from "vitest";
import { type AccountStores, createProfileSource, requestSignIn } from "./index";

const guest = {
  id: "p_guest",
  handle: "player",
  name: "Player",
  avatar: "https://tv.opengame.org/art/story-nook/char-owl.webp",
  token: "h.p.s",
  login: "guest" as const,
};

describe("guest or signed in (a game's own app, OGS shell)", () => {
  it("the profile says how the player is signed in", () => {
    const bridge = createMockBridge({
      isSupported: true,
      initialState: { profile: { status: "ready" as const, profile: guest } },
    });
    expect(createProfileSource({ bridge }).getSnapshot()).toEqual(guest);
  });

  it("requestSignIn sends SIGN_IN to the app's account store (the native sheet opens)", () => {
    const bridge = createMockBridge<AccountStores>({
      isSupported: true,
      initialState: { account: { login: "guest", signingIn: false } },
    });
    expect(requestSignIn(bridge)).toBe(true);
    expect(bridge.getHistory("account")).toEqual([{ type: "SIGN_IN" }]);
  });

  it("requestSignIn is false where there is no account store (a browser, the OGS app)", () => {
    expect(requestSignIn(createMockBridge<AccountStores>({ isSupported: true }))).toBe(false);
    expect(requestSignIn(createMockBridge<AccountStores>({ isSupported: false }))).toBe(false);
  });
});
