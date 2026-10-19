jest.mock("@open-game-system/app-bridge-react-native", () => ({ BridgedWebView: () => null }));
jest.mock("react-native-google-cast", () => ({
  __esModule: true,
  default: { showCastDialog: jest.fn() },
}));

describe('"@open-game-system/shell/app"', () => {
  it("exports <OgsShell />, ShellWebView and the device defaults", () => {
    const app: Record<string, unknown> = require("../shell-app");
    expect(typeof app.OgsShell).toBe("function");
    expect(typeof app.ShellWebView).toBe("function");
    expect(typeof app.defaultShellDeps).toBe("function");
  });

  it("the main entry stays free of the WebView", () => {
    const main: Record<string, unknown> = require("../index");
    expect(main.OgsShell).toBeUndefined();
    expect(typeof main.createShellRuntime).toBe("function");
    expect(typeof main.SignInSheet).toBe("function");
  });
});

describe("defaultShellDeps", () => {
  const config = {
    appId: "rocket-crew",
    gameUrl: "https://play.rocketcrew.tv/",
    name: "Rocket Crew",
    apiBase: "https://api.test",
    linkDomains: [],
  };

  it("offers no Sign in with Apple unless the app passes expo-apple-authentication in", async () => {
    const { defaultShellDeps } = require("../default-deps");
    const deps = defaultShellDeps(config);
    const apple = deps.signInProviders.find((p: { provider: string }) => p.provider === "apple");
    await expect(apple.isAvailable()).resolves.toBe(false);
  });

  it("uses the module the app passes in (iOS)", async () => {
    const { defaultShellDeps } = require("../default-deps");
    const appleAuthentication = {
      AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
      isAvailableAsync: async () => true,
      signInAsync: async () => ({ identityToken: "jwt" }),
    };
    const deps = defaultShellDeps(config, { appleAuthentication });
    const apple = deps.signInProviders.find((p: { provider: string }) => p.provider === "apple");
    await expect(apple.isAvailable()).resolves.toBe(true);
  });
});
