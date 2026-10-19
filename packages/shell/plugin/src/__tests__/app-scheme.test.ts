import type { ExpoConfig } from "expo/config";
import { describe, expect, it, vi } from "vitest";
import { withAppScheme } from "../app-scheme";
import { parseShellConfig, ShellConfigSchema } from "../shell-config";
import { createShellPlugins } from "../with-ogs-shell";

// Custom-scheme links (`<scheme>://play/<rest>`) need the app to register a scheme.
const props = { appId: "rocket-crew", gameUrl: "https://rocketcrew.tv/play", name: "Rocket Crew" };
const bare: ExpoConfig = { name: "Rocket Crew", slug: "rocket-crew" };
const shell = parseShellConfig(props);

describe("withAppScheme", () => {
  it("gives the app the appId as its scheme when it has none", () => {
    expect(withAppScheme(bare, shell)).toEqual({ ...bare, scheme: "rocket-crew" });
  });

  it("uses the shell config's scheme when set", () => {
    expect(withAppScheme(bare, parseShellConfig({ ...props, scheme: "rocketcrew" })).scheme).toBe(
      "rocketcrew",
    );
  });

  it("keeps the app's own scheme(s)", () => {
    expect(withAppScheme({ ...bare, scheme: "mine" }, shell).scheme).toBe("mine");
    expect(withAppScheme({ ...bare, scheme: ["a", "b"] }, shell).scheme).toEqual(["a", "b"]);
  });

  it("treats an empty scheme as none", () => {
    expect(withAppScheme({ ...bare, scheme: "" }, shell).scheme).toBe("rocket-crew");
    expect(withAppScheme({ ...bare, scheme: [] }, shell).scheme).toBe("rocket-crew");
  });

  it("does not change its input", () => {
    const input: ExpoConfig = { ...bare };
    withAppScheme(input, shell);
    expect(input).toEqual(bare);
  });
});

describe("the shell config's scheme", () => {
  it("is optional, with no default (the appId is used at merge time)", () => {
    expect(ShellConfigSchema.parse(props)).not.toHaveProperty("scheme");
  });

  it.each(["1abc", "has space", "a/b", "a:b", ""])("refuses %j", (scheme) => {
    expect(() => parseShellConfig({ ...props, scheme })).toThrow(/scheme/);
  });
});

describe("withOgsShell sets the scheme", () => {
  it("writes the appId as the scheme, once", () => {
    const apply = vi.fn((config: ExpoConfig) => config);
    const plugins = createShellPlugins(apply);
    const once = plugins.withOgsShell(bare, props);
    expect(once.scheme).toBe("rocket-crew");
    expect(plugins.withOgsShell({ ...bare, scheme: "own" }, props).scheme).toBe("own");
    expect(plugins.withShellScheme(bare, props).scheme).toBe("rocket-crew");
  });
});
