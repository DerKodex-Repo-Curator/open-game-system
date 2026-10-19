import { fakeFetch } from "../__fixtures__/fake-fetch";
import { fakeStorage } from "../__fixtures__/fake-storage";
import { createShellRequest } from "../api-client";
import { createGuestApi, ensureGuestProfile } from "../guest-profile";
import { createNativeAuthApi, createNativeSignIn } from "../native-sign-in";
import {
  IDENTITY_KEY,
  loadShellIdentity,
  type ShellIdentity,
  saveShellIdentity,
} from "../shell-identity";
import { createShellRuntime } from "../shell-runtime";

// A device token is only good on the API that issued it: a build switched between the production
// and preview APIs must not send one API's token to the other.
const PROD = "https://api.opengame.org";
const PREVIEW = "https://opengame-api-pr-shell.example.dev";

const device = { deviceId: "dev-1", kind: "phone" as const, name: "iPhone" };
const prodGuest: ShellIdentity = {
  profile: { id: "prod-guest", handle: "player", name: "Player", sticker: "owl" },
  deviceId: "dev-1",
  deviceToken: "prod-token",
  login: "guest",
};
const previewProfile = { id: "preview-guest", handle: "player2", name: "Player", sticker: "bear" };

describe("the stored identity belongs to one API base", () => {
  it("loads for the API base it was saved for, and for no other", async () => {
    const { storage } = fakeStorage();
    await saveShellIdentity(storage, prodGuest, PROD);
    await expect(loadShellIdentity(storage, PROD)).resolves.toEqual(prodGuest);
    await expect(loadShellIdentity(storage, PREVIEW)).resolves.toBeNull();
  });

  it("an identity saved without an API base is no one's when an API base is asked for", async () => {
    const { storage } = fakeStorage({ [IDENTITY_KEY]: JSON.stringify(prodGuest) });
    await expect(loadShellIdentity(storage, PROD)).resolves.toBeNull();
  });

  it("the guest flow makes a new guest on the new API instead of reusing the other API's", async () => {
    const { fetch, calls } = fakeFetch({
      "POST /api/v1/profiles": () => ({
        status: 201,
        body: { profile: previewProfile, token: "preview-token" },
      }),
    });
    const { storage } = fakeStorage();
    await saveShellIdentity(storage, prodGuest, PROD);
    const identity = await ensureGuestProfile({
      api: createGuestApi(createShellRequest({ baseUrl: PREVIEW, fetch })),
      apiBase: PREVIEW,
      storage,
      device: async () => device,
    });
    expect(calls).toHaveLength(1);
    expect(identity).toMatchObject({ profile: previewProfile, deviceToken: "preview-token" });
    await expect(loadShellIdentity(storage, PREVIEW)).resolves.toEqual(identity);
    await expect(loadShellIdentity(storage, PROD)).resolves.toBeNull();
  });

  it("the guest flow keeps the identity of its own API base", async () => {
    const { fetch, calls } = fakeFetch({});
    const { storage } = fakeStorage();
    await saveShellIdentity(storage, prodGuest, PROD);
    const identity = await ensureGuestProfile({
      api: createGuestApi(createShellRequest({ baseUrl: PROD, fetch })),
      apiBase: PROD,
      storage,
      device: async () => device,
    });
    expect(calls).toHaveLength(0);
    expect(identity).toEqual(prodGuest);
  });

  it("native sign-in doesn't upgrade another API's guest (no its token, no its profile id)", async () => {
    const { fetch, calls } = fakeFetch({
      "POST /api/v1/auth/native": () => ({
        status: 200,
        body: { profile: previewProfile, logins: [], token: "apple-token" },
      }),
    });
    const { storage } = fakeStorage();
    await saveShellIdentity(storage, prodGuest, PROD);
    const flow = createNativeSignIn({
      api: createNativeAuthApi(createShellRequest({ baseUrl: PREVIEW, fetch })),
      apiBase: PREVIEW,
      storage,
      device: async () => device,
      providers: [
        {
          provider: "apple",
          isAvailable: async () => true,
          signIn: async () => ({ status: "ok", identityToken: "apple-jwt" }),
        },
      ],
    });
    await flow.start("apple");
    expect(calls[0]?.headers.Authorization).toBeUndefined();
    expect(calls[0]?.body).not.toHaveProperty("deviceProfileId");
    await expect(loadShellIdentity(storage, PREVIEW)).resolves.toMatchObject({
      deviceToken: "apple-token",
      login: "apple",
    });
  });

  it("the runtime on the preview API ignores the production identity and starts a preview guest", async () => {
    const { fetch, calls } = fakeFetch({
      "POST /api/v1/profiles": () => ({
        status: 201,
        body: { profile: previewProfile, token: "preview-token" },
      }),
    });
    const { storage } = fakeStorage();
    await saveShellIdentity(storage, prodGuest, PROD);
    const runtime = createShellRuntime(
      {
        appId: "rocket-crew",
        gameUrl: "https://play.rocketcrew.tv/phone",
        name: "Rocket Crew",
        apiBase: PREVIEW,
        linkDomains: [],
      },
      {
        fetch,
        storage,
        device: async () => device,
        notifications: {
          getPermissionsAsync: async () => ({ granted: false }),
          requestPermissionsAsync: async () => ({ granted: false }),
          getDevicePushTokenAsync: async () => ({ type: "ios", data: "t" }),
          addPushTokenListener: () => ({ remove: () => {} }),
        },
        platform: "ios",
        apnsEnvironment: async () => "production",
        haptics: { impact: async () => {}, notify: async () => {} },
        signInProviders: [],
      },
    );
    await runtime.start();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`POST ${PREVIEW}/api/v1/profiles`]);
    expect(runtime.getIdentity()).toMatchObject({ deviceToken: "preview-token" });
    await expect(loadShellIdentity(storage, PREVIEW)).resolves.toMatchObject({
      deviceToken: "preview-token",
    });
    runtime.stop();
  });
});
