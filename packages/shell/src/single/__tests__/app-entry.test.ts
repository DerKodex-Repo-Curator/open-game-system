jest.mock("@open-game-system/app-bridge-react-native", () => ({ BridgedWebView: () => null }));
jest.mock("react-native-google-cast", () => ({
  __esModule: true,
  default: { showCastDialog: jest.fn() },
}));

describe('"@open-game-system/shell/app"', () => {
  it("exports <OgsShell />, ShellWebView and the device defaults", () => {
    const app: Record<string, unknown> = require("../app");
    expect(typeof app.OgsShell).toBe("function");
    expect(typeof app.ShellWebView).toBe("function");
    expect(typeof app.defaultShellDeps).toBe("function");
  });

  it("the main entry stays free of the WebView", () => {
    const main: Record<string, unknown> = require("../../index");
    expect(main.OgsShell).toBeUndefined();
    expect(typeof main.createShellRuntime).toBe("function");
    expect(typeof main.SignInSheet).toBe("function");
  });
});
