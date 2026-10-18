import { DEFAULT_OGS_API, readRuntimeConfig } from "../runtime-config";

const expoConfig = {
  name: "Rocket Crew",
  extra: {
    ogsShell: {
      appId: "rocket-crew",
      gameUrl: "https://play.rocketcrew.tv/phone",
      branding: "powered-by",
      linkDomains: ["rocketcrew.tv"],
    },
  },
};

describe("readRuntimeConfig (Constants.expoConfig written by the shell plugin)", () => {
  it("reads extra.ogsShell and the app's name, with the OGS API by default", () => {
    expect(readRuntimeConfig(expoConfig)).toEqual({
      appId: "rocket-crew",
      gameUrl: "https://play.rocketcrew.tv/phone",
      name: "Rocket Crew",
      branding: "powered-by",
      linkDomains: ["rocketcrew.tv"],
      apiBase: DEFAULT_OGS_API,
    });
    expect(DEFAULT_OGS_API).toMatch(/^https:\/\//);
  });

  it("takes an apiBase from extra.ogsShell when set (preview builds)", () => {
    const withApi = {
      ...expoConfig,
      extra: { ogsShell: { ...expoConfig.extra.ogsShell, apiBase: "https://api.preview.test" } },
    };
    expect(readRuntimeConfig(withApi).apiBase).toBe("https://api.preview.test");
  });

  it("defaults branding to hidden and link domains to none", () => {
    const bare = {
      name: "X",
      extra: { ogsShell: { appId: "x", gameUrl: "https://x.example/" } },
    };
    expect(readRuntimeConfig(bare)).toMatchObject({ branding: "hidden", linkDomains: [] });
  });

  it("throws a clear error without the plugin's config", () => {
    expect(() => readRuntimeConfig(null)).toThrow(/@open-game-system\/shell/);
    expect(() => readRuntimeConfig({ name: "X", extra: {} })).toThrow(/extra\.ogsShell/);
    expect(() =>
      readRuntimeConfig({ name: "X", extra: { ogsShell: { appId: "x", gameUrl: "http://x" } } }),
    ).toThrow(/gameUrl/);
  });
});
