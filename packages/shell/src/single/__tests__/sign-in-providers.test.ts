import { type AppleAuthModule, appleSignIn, unavailableSignIn } from "../sign-in-providers";

function fakeApple(over: Partial<AppleAuthModule> = {}) {
  const calls: unknown[] = [];
  const mod: AppleAuthModule = {
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    isAvailableAsync: async () => true,
    signInAsync: async (opts) => {
      calls.push(opts);
      return { identityToken: "apple-jwt" };
    },
    ...over,
  };
  return { mod, calls };
}

describe("appleSignIn (expo-apple-authentication)", () => {
  it("asks for name and email with a fresh nonce and returns the token with that nonce", async () => {
    const { mod, calls } = fakeApple();
    const apple = appleSignIn(mod, () => "nonce-1");
    expect(apple.provider).toBe("apple");
    await expect(apple.signIn()).resolves.toEqual({
      status: "ok",
      identityToken: "apple-jwt",
      nonce: "nonce-1",
    });
    expect(calls).toEqual([{ requestedScopes: [0, 1], nonce: "nonce-1" }]);
  });

  it("is cancelled when the person dismisses Apple's sheet", async () => {
    const { mod } = fakeApple({
      signInAsync: async () => {
        throw Object.assign(new Error("canceled"), { code: "ERR_REQUEST_CANCELED" });
      },
    });
    await expect(appleSignIn(mod, () => "n").signIn()).resolves.toEqual({ status: "cancelled" });
  });

  it("throws other failures and a missing token", async () => {
    const failing = fakeApple({
      signInAsync: async () => {
        throw Object.assign(new Error("x"), { code: "ERR_REQUEST_FAILED" });
      },
    });
    await expect(appleSignIn(failing.mod, () => "n").signIn()).rejects.toThrow("x");
    const tokenless = fakeApple({ signInAsync: async () => ({ identityToken: null }) });
    await expect(appleSignIn(tokenless.mod, () => "n").signIn()).rejects.toThrow(/identity token/);
  });

  it("is available when the module says so", async () => {
    const { mod } = fakeApple({ isAvailableAsync: async () => false });
    await expect(appleSignIn(mod, () => "n").isAvailable()).resolves.toBe(false);
    await expect(appleSignIn(fakeApple().mod, () => "n").isAvailable()).resolves.toBe(true);
  });
});

describe("unavailableSignIn (Google on iOS until it ships)", () => {
  it("is never available and refuses to sign in", async () => {
    const google = unavailableSignIn("google");
    expect(google.provider).toBe("google");
    await expect(google.isAvailable()).resolves.toBe(false);
    await expect(google.signIn()).rejects.toThrow(/google/);
  });
});
