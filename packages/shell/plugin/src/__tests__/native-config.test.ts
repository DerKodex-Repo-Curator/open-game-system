import { describe, expect, it } from "vitest";
import { nativeConfigFor, OGS_CAST_RECEIVER_APP_ID } from "../native-config";
import { ShellConfigSchema } from "../shell-config";

// docs/acceptance/2026-10-18-white-label-shell.feature, "The plugin writes the native config the shell needs".
const config = ShellConfigSchema.parse({
  appId: "rocket-crew",
  gameUrl: "https://rocketcrew.tv/play",
  name: "Rocket Crew",
  linkDomains: ["rocketcrew.tv"],
});

describe("nativeConfigFor", () => {
  it("claims the developer's domains and opengame.org on iOS", () => {
    expect(nativeConfigFor(config).ios.associatedDomains).toEqual([
      "applinks:rocketcrew.tv",
      "applinks:opengame.org",
    ]);
  });

  it("claims opengame.org once when the developer lists it too", () => {
    const native = nativeConfigFor({ ...config, linkDomains: ["opengame.org", "rocketcrew.tv"] });
    expect(native.ios.associatedDomains).toEqual([
      "applinks:opengame.org",
      "applinks:rocketcrew.tv",
    ]);
  });

  it("claims only opengame.org without link domains", () => {
    expect(nativeConfigFor({ ...config, linkDomains: [] }).ios.associatedDomains).toEqual([
      "applinks:opengame.org",
    ]);
  });

  it("enables Sign in with Apple", () => {
    expect(nativeConfigFor(config).ios.usesAppleSignIn).toBe(true);
  });

  it("asks for the local network in the app's name and browses for Chromecasts", () => {
    const { infoPlist } = nativeConfigFor(config).ios;
    expect(infoPlist.NSLocalNetworkUsageDescription).toContain("Rocket Crew");
    expect(infoPlist.NSLocalNetworkUsageDescription).not.toContain("OGS");
    expect(infoPlist.NSBonjourServices).toEqual(["_googlecast._tcp"]);
  });

  it("verifies App Links for each link domain (whole site) and opengame.org/play/<appId>", () => {
    expect(nativeConfigFor(config).android.intentFilters).toEqual([
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: "rocketcrew.tv", pathPrefix: "/" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: "opengame.org", pathPrefix: "/play/rocket-crew" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ]);
  });

  it("keeps opengame.org to the app's /play path even when listed as a link domain", () => {
    const filters = nativeConfigFor({ ...config, linkDomains: ["opengame.org"] }).android
      .intentFilters;
    expect(filters.map((f) => f.data[0])).toEqual([
      { scheme: "https", host: "opengame.org", pathPrefix: "/play/rocket-crew" },
    ]);
  });

  it("applies the cast, push, Apple sign-in and splash plugins", () => {
    expect(nativeConfigFor(config).plugins).toEqual([
      [
        "react-native-google-cast",
        { receiverAppId: "807AD5E9", iosStartDiscoveryAfterFirstTapOnCastButton: false },
      ],
      "expo-notifications",
      "expo-apple-authentication",
      "expo-splash-screen",
    ]);
    expect(OGS_CAST_RECEIVER_APP_ID).toBe("807AD5E9");
  });

  it("passes the splash to expo-splash-screen", () => {
    const native = nativeConfigFor({
      ...config,
      splash: { image: "./assets/splash.png", backgroundColor: "#0b1020" },
    });
    expect(native.plugins).toContainEqual([
      "expo-splash-screen",
      {
        image: "./assets/splash.png",
        backgroundColor: "#0b1020",
        imageWidth: 200,
        resizeMode: "contain",
      },
    ]);
  });

  it("writes what the runtime reads to extra.ogsShell", () => {
    expect(nativeConfigFor({ ...config, branding: "powered-by" }).extra).toEqual({
      ogsShell: {
        appId: "rocket-crew",
        gameUrl: "https://rocketcrew.tv/play",
        branding: "powered-by",
        linkDomains: ["rocketcrew.tv"],
      },
    });
  });

  it("sets the icon only when the developer gives one", () => {
    expect("icon" in nativeConfigFor(config)).toBe(false);
    expect(nativeConfigFor({ ...config, icon: "./assets/icon.png" }).icon).toBe(
      "./assets/icon.png",
    );
  });

  it("never writes the developer's identity", () => {
    const native = nativeConfigFor({ ...config, icon: "./assets/icon.png" });
    expect(Object.keys(native).sort()).toEqual(["android", "extra", "icon", "ios", "plugins"]);
    expect(Object.keys(native.ios).sort()).toEqual([
      "associatedDomains",
      "infoPlist",
      "usesAppleSignIn",
    ]);
    expect(Object.keys(native.android)).toEqual(["intentFilters"]);
    expect(JSON.stringify(native)).not.toMatch(/bundleIdentifier|package|appleTeamId|owner/);
  });
});
