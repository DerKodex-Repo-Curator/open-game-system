import { readRuntimeConfig } from "../runtime-config";
import { createShellRuntime } from "../shell-runtime";

const base = {
  name: "Rocket Crew",
  extra: { ogsShell: { appId: "rocket-crew", gameUrl: "https://play.rocketcrew.tv/phone" } },
};

describe("readRuntimeConfig: the app's custom scheme (Expo `scheme`)", () => {
  it("reads one scheme or a list", () => {
    expect(readRuntimeConfig({ ...base, scheme: "rocket-crew" }).schemes).toEqual(["rocket-crew"]);
    expect(readRuntimeConfig({ ...base, scheme: ["rc", "rocket-crew"] }).schemes).toEqual([
      "rc",
      "rocket-crew",
    ]);
  });

  it("leaves schemes out when the app has none (links then use the appId)", () => {
    expect(readRuntimeConfig(base)).not.toHaveProperty("schemes");
  });

  it("the runtime opens a scheme link on the game", () => {
    const config = readRuntimeConfig({ ...base, scheme: "rc" });
    const runtime = createShellRuntime(config, {
      fetch: async () => new Response("{}"),
      storage: {
        getItemAsync: async () => null,
        setItemAsync: async () => {},
        deleteItemAsync: async () => {},
      },
      device: async () => ({ deviceId: "d", kind: "phone", name: "iPhone" }),
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
    });
    expect(runtime.webViewUrlFor("rc://play/rocket-crew/join/ABCD")).toBe(
      "https://play.rocketcrew.tv/join/ABCD",
    );
    expect(runtime.webViewUrlFor("rocket-crew://join/ABCD")).toBeNull();
  });
});
