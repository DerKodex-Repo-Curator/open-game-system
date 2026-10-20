import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { fakeContext } from "../__fixtures__/fake-context";
import { castGameStores } from "../cast-stores";
import { streamServerUrl } from "../cast-view";
import { askToNotify } from "../consent-sheet";
import { defaultShellDeps } from "../default-deps";
import { ogsGameStores } from "../game-stores";
import { createGoogleCastBackend } from "../google-cast-backend";
import type { AppleAuthModule } from "../sign-in-providers";

const mockDevice: { deviceType: number; deviceName: string | null; modelName: string | null } = {
  deviceType: 1,
  deviceName: "Jon's iPhone",
  modelName: "iPhone 16",
};
jest.mock("expo-device", () => ({
  DeviceType: { PHONE: 1, TABLET: 2 },
  get deviceType() {
    return mockDevice.deviceType;
  },
  get deviceName() {
    return mockDevice.deviceName;
  },
  get modelName() {
    return mockDevice.modelName;
  },
}));
let mockUuids = 0;
jest.mock("expo-crypto", () => ({ randomUUID: () => `uuid-${++mockUuids}` }));
jest.mock("expo-application", () => ({
  getIosPushNotificationServiceEnvironmentAsync: async () => "development",
}));
const mockSecure = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockSecure.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mockSecure.delete(key);
  },
}));
jest.mock("expo-notifications", () => ({ setNotificationHandler: () => {} }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {} },
}));
jest.mock("../google-cast-backend", () => ({ createGoogleCastBackend: jest.fn(() => "backend") }));
const mockCastStore = { name: "cast" };
const mockProfileStore = { name: "profile" };
jest.mock("../cast-stores", () => ({
  castGameStores: jest.fn(() => () => ({ cast: mockCastStore })),
}));
jest.mock("../game-stores", () => ({
  ogsGameStores: jest.fn(() => () => ({ profile: mockProfileStore })),
}));
jest.mock("../consent-sheet", () => ({ askToNotify: jest.fn() }));

const config = {
  appId: "rocket-crew",
  gameUrl: "https://play.rocketcrew.tv/phone",
  name: "Rocket Crew",
  apiBase: "https://api.test",
  linkDomains: [],
};

function appleModule(): AppleAuthModule & { nonces: (string | undefined)[] } {
  const nonces: (string | undefined)[] = [];
  return {
    nonces,
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    isAvailableAsync: async () => true,
    signInAsync: async (options) => {
      nonces.push(options.nonce);
      return { identityToken: "apple-jwt" };
    },
  };
}

beforeEach(() => {
  mockSecure.clear();
  mockDevice.deviceType = 1;
  mockDevice.deviceName = "Jon's iPhone";
  mockDevice.modelName = "iPhone 16";
});
afterEach(() => jest.restoreAllMocks());

describe("defaultShellDeps (a real device's dependencies)", () => {
  it("fetches with the global fetch", async () => {
    const answer = new Response(null, { status: 204 });
    const fetch = jest.spyOn(globalThis, "fetch").mockResolvedValue(answer);
    const init = { method: "POST" };
    await expect(defaultShellDeps(config).fetch("https://api.test/x", init)).resolves.toBe(answer);
    expect(fetch).toHaveBeenCalledWith("https://api.test/x", init);
  });

  it("this device: an id minted once into SecureStore, a phone by its own name", async () => {
    const device = defaultShellDeps(config).device;
    const first = await device();
    expect(first).toEqual({
      deviceId: expect.stringMatching(/^uuid-/),
      kind: "phone",
      name: "Jon's iPhone",
    });
    expect(mockSecure.get("ogs.deviceId")).toBe(first.deviceId);
    expect((await device()).deviceId).toBe(first.deviceId);
  });

  it("a tablet, named by its model when it has no name", async () => {
    mockDevice.deviceType = 2;
    mockDevice.deviceName = null;
    expect(await defaultShellDeps(config).device()).toMatchObject({
      kind: "tablet",
      name: "iPhone 16",
    });
  });

  it("is ios on iOS and android on Android", () => {
    jest.replaceProperty(Platform, "OS", "ios");
    expect(defaultShellDeps(config).platform).toBe("ios");
    jest.replaceProperty(Platform, "OS", "android");
    expect(defaultShellDeps(config).platform).toBe("android");
  });

  it("reads the APNs environment from the build's entitlement", async () => {
    await expect(defaultShellDeps(config).apnsEnvironment()).resolves.toBe("sandbox");
  });

  it("offers Sign in with Apple on iOS when the app passes the module, with a fresh nonce", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    const apple = appleModule();
    const [first, second] = defaultShellDeps(config, {
      appleAuthentication: apple,
    }).signInProviders;
    expect(first?.provider).toBe("apple");
    await expect(first?.isAvailable()).resolves.toBe(true);
    const credential = await first?.signIn();
    expect(apple.nonces).toEqual([expect.stringMatching(/^uuid-/)]);
    expect(credential).toEqual({
      status: "ok",
      identityToken: "apple-jwt",
      nonce: apple.nonces[0],
    });
    expect(second?.provider).toBe("google");
    await expect(second?.isAvailable()).resolves.toBe(false);
  });

  it("offers no Apple sign-in on Android, or without the module", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const onAndroid = defaultShellDeps(config, { appleAuthentication: appleModule() });
    await expect(onAndroid.signInProviders[0]?.isAvailable()).resolves.toBe(false);
    jest.replaceProperty(Platform, "OS", "ios");
    const without = defaultShellDeps(config);
    expect(without.signInProviders[0]?.provider).toBe("apple");
    await expect(without.signInProviders[0]?.isAvailable()).resolves.toBe(false);
  });

  it("the game's stores: Google Cast with browser TVs in AsyncStorage, and the OGS stores", () => {
    const { ctx } = fakeContext(async () => new Response(null));
    const stores = defaultShellDeps(config).gameStores?.(ctx);
    expect(stores).toEqual({ cast: mockCastStore, profile: mockProfileStore });
    expect(castGameStores).toHaveBeenCalledWith("backend", {
      streamServerUrl: streamServerUrl({}, config.apiBase),
      browserTvStorage: AsyncStorage,
    });
    expect(createGoogleCastBackend).toHaveBeenCalled();
    expect(ogsGameStores).toHaveBeenCalledWith({ askPlayer: askToNotify });
  });
});
