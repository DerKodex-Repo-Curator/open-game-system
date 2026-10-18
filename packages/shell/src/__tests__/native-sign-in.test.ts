import { type FakeAnswer, fakeFetch } from "../__fixtures__/fake-fetch";
import { fakeStorage } from "../__fixtures__/fake-storage";
import { createShellRequest } from "../api-client";
import {
  createNativeAuthApi,
  createNativeSignIn,
  type NativeSignInProvider,
  type SignInState,
} from "../native-sign-in";
import { loadShellIdentity, type ShellIdentity, saveShellIdentity } from "../shell-identity";

const device = { deviceId: "dev-1", kind: "phone" as const, name: "iPhone" };
const guest: ShellIdentity = {
  profile: { id: "guest-1", handle: "player", name: "Player", sticker: "owl" },
  deviceId: "dev-1",
  deviceToken: "guest-token",
  login: "guest",
};
const signedIn = {
  profile: { id: "guest-1", handle: "player", name: "Player", sticker: "owl" },
  logins: [{ provider: "apple", email: "j@example.com" }],
  token: "new-token",
};

function provider(
  name: "apple" | "google",
  answer: Awaited<ReturnType<NativeSignInProvider["signIn"]>> | Error,
): NativeSignInProvider & { calls: number } {
  const p = {
    provider: name,
    calls: 0,
    isAvailable: async () => true,
    signIn: async () => {
      p.calls += 1;
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return p;
}

async function setup(opts: {
  stored?: ShellIdentity | null;
  answer?: () => FakeAnswer;
  providers?: NativeSignInProvider[];
}) {
  const { fetch, calls } = fakeFetch({
    "POST /api/v1/auth/native": opts.answer ?? (() => ({ status: 200, body: signedIn })),
  });
  const { storage } = fakeStorage();
  if (opts.stored !== null) await saveShellIdentity(storage, opts.stored ?? guest);
  const onIdentity = jest.fn();
  const flow = createNativeSignIn({
    api: createNativeAuthApi(createShellRequest({ baseUrl: "https://api.test", fetch })),
    storage,
    device: async () => device,
    providers: opts.providers ?? [
      provider("apple", { status: "ok", identityToken: "apple-jwt", nonce: "n-1" }),
    ],
    onIdentity,
  });
  const states: SignInState[] = [];
  flow.subscribe((s) => states.push(s));
  return { flow, calls, storage, onIdentity, states };
}

describe("native sign-in", () => {
  it("starts idle", async () => {
    const { flow, states } = await setup({});
    expect(flow.getState()).toEqual({ status: "idle" });
    expect(states).toEqual([{ status: "idle" }]);
  });

  it("links the guest: Bearer guest token + deviceProfileId, then swaps the stored identity", async () => {
    const { flow, calls, storage, onIdentity, states } = await setup({});
    await flow.start("apple");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.test/api/v1/auth/native");
    expect(calls[0]?.headers.Authorization).toBe("Bearer guest-token");
    expect(calls[0]?.body).toEqual({
      provider: "apple",
      identityToken: "apple-jwt",
      nonce: "n-1",
      deviceProfileId: "guest-1",
      device,
    });
    const expected: ShellIdentity = {
      profile: signedIn.profile,
      deviceId: "dev-1",
      deviceToken: "new-token",
      login: "apple",
    };
    await expect(loadShellIdentity(storage)).resolves.toEqual(expected);
    expect(onIdentity).toHaveBeenCalledWith(expected);
    expect(states).toEqual([
      { status: "idle" },
      { status: "signing-in", provider: "apple" },
      { status: "signed-in", provider: "apple", profile: signedIn.profile },
    ]);
  });

  it("takes the profile the login already backs (another device signed in first)", async () => {
    const other = { ...signedIn, profile: { ...signedIn.profile, id: "owner-9", handle: "jon" } };
    const { flow, storage } = await setup({ answer: () => ({ status: 200, body: other }) });
    await flow.start("apple");
    await expect(loadShellIdentity(storage)).resolves.toMatchObject({
      profile: { id: "owner-9" },
      deviceToken: "new-token",
      deviceId: "dev-1",
    });
  });

  it("signs in without a guest: no Authorization, no deviceProfileId, the device's own id", async () => {
    const { flow, calls, storage } = await setup({ stored: null });
    await flow.start("apple");
    expect(calls[0]?.headers.Authorization).toBeUndefined();
    expect(calls[0]?.body).toEqual({
      provider: "apple",
      identityToken: "apple-jwt",
      nonce: "n-1",
      device,
    });
    await expect(loadShellIdentity(storage)).resolves.toMatchObject({
      deviceId: "dev-1",
      login: "apple",
    });
  });

  it("omits the nonce when the provider has none", async () => {
    const { flow, calls } = await setup({
      providers: [provider("google", { status: "ok", identityToken: "g-jwt" })],
    });
    await flow.start("google");
    expect(calls[0]?.body).toEqual({
      provider: "google",
      identityToken: "g-jwt",
      deviceProfileId: "guest-1",
      device,
    });
  });

  it("is cancelled when the person closes the native sheet; nothing is sent or stored", async () => {
    const { flow, calls, storage, onIdentity } = await setup({
      providers: [provider("apple", { status: "cancelled" })],
    });
    await flow.start("apple");
    expect(flow.getState()).toEqual({ status: "cancelled" });
    expect(calls).toHaveLength(0);
    await expect(loadShellIdentity(storage)).resolves.toEqual(guest);
    expect(onIdentity).not.toHaveBeenCalled();
  });

  it("is an error with the API's code, keeping the guest", async () => {
    const { flow, storage } = await setup({
      answer: () => ({
        status: 401,
        body: { error: { code: "invalid_token", message: "bad", status: 401 } },
      }),
    });
    await flow.start("apple");
    expect(flow.getState()).toEqual({ status: "error", code: "invalid_token" });
    await expect(loadShellIdentity(storage)).resolves.toEqual(guest);
  });

  it("is an error when the answer has no token", async () => {
    const { flow } = await setup({
      answer: () => ({ status: 200, body: { profile: signedIn.profile, logins: [] } }),
    });
    await flow.start("apple");
    expect(flow.getState()).toEqual({ status: "error", code: "BAD_RESPONSE" });
  });

  it("is an error when the provider throws or is not offered", async () => {
    const broken = await setup({ providers: [provider("apple", new Error("boom"))] });
    await broken.flow.start("apple");
    expect(broken.flow.getState()).toEqual({ status: "error", code: "PROVIDER_FAILED" });
    const none = await setup({});
    await none.flow.start("google");
    expect(none.flow.getState()).toEqual({ status: "error", code: "PROVIDER_UNAVAILABLE" });
  });

  it("ignores a second start while signing in", async () => {
    const apple = provider("apple", { status: "ok", identityToken: "apple-jwt", nonce: "n-1" });
    const { flow, calls } = await setup({ providers: [apple] });
    await Promise.all([flow.start("apple"), flow.start("apple")]);
    expect(apple.calls).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("can start again after cancel or error, and reset returns to idle", async () => {
    const { flow } = await setup({
      providers: [provider("apple", { status: "cancelled" })],
    });
    await flow.start("apple");
    flow.reset();
    expect(flow.getState()).toEqual({ status: "idle" });
  });

  it("stops telling a listener that unsubscribed", async () => {
    const { flow } = await setup({});
    const seen: SignInState[] = [];
    const off = flow.subscribe((s) => seen.push(s));
    off();
    await flow.start("apple");
    expect(seen).toEqual([{ status: "idle" }]);
  });
});
