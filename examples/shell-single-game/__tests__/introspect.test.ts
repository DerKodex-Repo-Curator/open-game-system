import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * The fixture app's config as Expo resolves it after every config plugin and native mod
 * (`expo config --type introspect`): what a prebuild would write, without running one.
 * docs/acceptance/2026-10-18-white-label-shell.feature.
 */
const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const IntentFilterSchema = z.object({
  action: z.string(),
  autoVerify: z.boolean().optional(),
  data: z.array(
    z.object({
      scheme: z.string().optional(),
      host: z.string().optional(),
      pathPrefix: z.string().optional(),
    }),
  ),
  category: z.array(z.string()).optional(),
});

const IntrospectedConfigSchema = z.object({
  ios: z.object({
    bundleIdentifier: z.string(),
    associatedDomains: z.array(z.string()),
    usesAppleSignIn: z.boolean().optional(),
    infoPlist: z.object({
      NSBonjourServices: z.array(z.string()),
      NSLocalNetworkUsageDescription: z.string(),
    }),
    entitlements: z.record(z.string(), z.unknown()),
  }),
  android: z.object({
    package: z.string(),
    intentFilters: z.array(IntentFilterSchema),
  }),
  extra: z.object({ ogsShell: z.unknown() }),
});

type IntrospectedConfig = z.infer<typeof IntrospectedConfigSchema>;

function introspect(): IntrospectedConfig {
  const stdout = execFileSync("npx", ["expo", "config", "--type", "introspect", "--json"], {
    cwd: appDir,
    encoding: "utf8",
    env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1", EXPO_OFFLINE: "1" },
    maxBuffer: 32 * 1024 * 1024,
  });
  return IntrospectedConfigSchema.parse(JSON.parse(stdout));
}

const filterFor = (config: IntrospectedConfig, host: string) =>
  config.android.intentFilters.find((filter) => filter.data.some((d) => d.host === host));

describe("examples/shell-single-game: the shell plugin's native config", () => {
  let config: IntrospectedConfig;
  beforeAll(() => {
    config = introspect();
  });

  it("claims the game's link domain and opengame.org for iOS universal links", () => {
    expect(config.ios.associatedDomains).toEqual(
      expect.arrayContaining(["applinks:example.com", "applinks:opengame.org"]),
    );
    expect(config.ios.entitlements["com.apple.developer.associated-domains"]).toEqual(
      expect.arrayContaining(["applinks:example.com", "applinks:opengame.org"]),
    );
  });

  it("verifies Android App Links for example.com and opengame.org/play/example-game", () => {
    expect(filterFor(config, "example.com")).toEqual({
      action: "VIEW",
      autoVerify: true,
      data: [{ scheme: "https", host: "example.com", pathPrefix: "/" }],
      category: ["BROWSABLE", "DEFAULT"],
    });
    expect(filterFor(config, "opengame.org")).toEqual({
      action: "VIEW",
      autoVerify: true,
      data: [{ scheme: "https", host: "opengame.org", pathPrefix: "/play/example-game" }],
      category: ["BROWSABLE", "DEFAULT"],
    });
  });

  it("lets iOS find Chromecasts running the OGS receiver on the local network", () => {
    expect(config.ios.infoPlist.NSBonjourServices).toEqual(
      expect.arrayContaining(["_googlecast._tcp", "_807AD5E9._googlecast._tcp"]),
    );
    expect(config.ios.infoPlist.NSLocalNetworkUsageDescription).toContain("Example Game");
  });

  it("turns on Sign in with Apple", () => {
    expect(config.ios.usesAppleSignIn).toBe(true);
    expect(config.ios.entitlements["com.apple.developer.applesignin"]).toEqual(["Default"]);
  });

  it("hands the runtime its config in extra.ogsShell", () => {
    expect(config.extra.ogsShell).toEqual({
      appId: "example-game",
      gameUrl: "https://example.com/phone",
      branding: "powered-by",
      linkDomains: ["example.com"],
    });
  });

  it("leaves the developer's bundle identifier and package as written", () => {
    expect(config.ios.bundleIdentifier).toBe("com.example.game");
    expect(config.android.package).toBe("com.example.game");
  });
});
