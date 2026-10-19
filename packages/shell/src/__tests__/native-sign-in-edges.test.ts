import { fakeFetch } from "../__fixtures__/fake-fetch";
import { fakeStorage } from "../__fixtures__/fake-storage";
import { createShellRequest } from "../api-client";
import type { ShellDevice } from "../guest-profile";
import type { SecureStorage } from "../identity";
import {
  createNativeAuthApi,
  createNativeSignIn,
  type NativeSignInProvider,
} from "../native-sign-in";

const device: ShellDevice = { deviceId: "dev-1", kind: "phone", name: "iPhone" };
const profile = { id: "p-1", handle: "jon", name: "Jon", sticker: "owl" };

const apple = (signIn: NativeSignInProvider["signIn"]): NativeSignInProvider => ({
  provider: "apple",
  isAvailable: async () => true,
  signIn,
});

function setup(opts: {
  logins?: unknown[];
  storage?: SecureStorage;
  signIn?: NativeSignInProvider["signIn"];
}) {
  const net = fakeFetch({
    "POST /api/v1/auth/native": () => ({
      status: 200,
      body: { profile, logins: opts.logins ?? [], token: "t" },
    }),
  });
  return createNativeSignIn({
    api: createNativeAuthApi(createShellRequest({ baseUrl: "https://api.test", fetch: net.fetch })),
    storage: opts.storage ?? fakeStorage().storage,
    device: async () => device,
    providers: [apple(opts.signIn ?? (async () => ({ status: "ok", identityToken: "jwt" })))],
  });
}

describe("native sign-in, edges", () => {
  it("signs in with no onIdentity listener", async () => {
    const flow = setup({});
    await flow.start("apple");
    expect(flow.getState()).toEqual({ status: "signed-in", provider: "apple", profile });
  });

  it("takes a profile whose logins include Google and email", async () => {
    const flow = setup({
      logins: [
        { provider: "google", email: "j@example.com" },
        { provider: "email", email: null },
      ],
    });
    await flow.start("apple");
    expect(flow.getState().status).toBe("signed-in");
  });

  it("a failure that isn't the API's is FAILED", async () => {
    const storage: SecureStorage = {
      getItemAsync: async () => null,
      setItemAsync: async () => {
        throw new Error("keychain locked");
      },
      deleteItemAsync: async () => {},
    };
    const flow = setup({ storage });
    await flow.start("apple");
    expect(flow.getState()).toEqual({ status: "error", code: "FAILED" });
  });

  it("reset while signing in changes nothing", async () => {
    let finish: () => void = () => {};
    const flow = setup({
      signIn: () =>
        new Promise((resolve) => {
          finish = () => resolve({ status: "cancelled" });
        }),
    });
    const started = flow.start("apple");
    flow.reset();
    expect(flow.getState()).toEqual({ status: "signing-in", provider: "apple" });
    finish();
    await started;
    flow.reset();
    expect(flow.getState()).toEqual({ status: "idle" });
  });
});

describe("native sign-in, the answer's logins", () => {
  it("an answer naming a login OGS doesn't have is a bad response", async () => {
    const flow = setup({ logins: [{ provider: "facebook", email: null }] });
    await flow.start("apple");
    expect(flow.getState()).toEqual({ status: "error", code: "BAD_RESPONSE" });
  });
});
