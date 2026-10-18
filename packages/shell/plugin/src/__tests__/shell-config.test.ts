import { describe, expect, it } from "vitest";
import { parseShellConfig, ShellConfigSchema } from "../shell-config";

// docs/acceptance/2026-10-18-white-label-shell.feature, "The shell config is parsed at the boundary".
const minimal = {
  appId: "rocket-crew",
  gameUrl: "https://rocketcrew.tv/play",
  name: "Rocket Crew",
};

describe("ShellConfigSchema", () => {
  it("fills the defaults for a minimal config", () => {
    expect(ShellConfigSchema.parse(minimal)).toEqual({
      ...minimal,
      branding: "hidden",
      linkDomains: [],
      cast: { receiver: "ogs" },
    });
  });

  it("keeps everything the developer sets", () => {
    const full = {
      ...minimal,
      icon: "./assets/icon.png",
      splash: { image: "./assets/splash.png", backgroundColor: "#0b1020" },
      branding: "powered-by",
      linkDomains: ["rocketcrew.tv", "www.rocketcrew.tv"],
      cast: { receiver: "ogs" },
    };
    expect(ShellConfigSchema.parse(full)).toEqual(full);
  });

  it.each([
    ["http://rocketcrew.tv/play", "gameUrl"],
    ["not a url", "gameUrl"],
  ])("rejects gameUrl %s", (gameUrl, field) => {
    expect(() => parseShellConfig({ ...minimal, gameUrl })).toThrow(field);
  });

  it.each(["Rocket Crew!", "", "rocket_crew", "Rocket-crew"])("rejects appId %j", (appId) => {
    expect(() => parseShellConfig({ ...minimal, appId })).toThrow("appId");
  });

  it("rejects an empty name", () => {
    expect(() => parseShellConfig({ ...minimal, name: "" })).toThrow("name");
  });

  it("rejects an unknown branding", () => {
    expect(() => parseShellConfig({ ...minimal, branding: "ogs" })).toThrow("branding");
  });

  it.each([
    "https://rocketcrew.tv",
    "rocketcrew.tv/play",
    "rocket crew.tv",
    "",
  ])("rejects link domain %j (a bare host name)", (domain) => {
    expect(() => parseShellConfig({ ...minimal, linkDomains: [domain] })).toThrow("linkDomains");
  });

  it("rejects a receiver other than the OGS receiver (v1)", () => {
    expect(() => parseShellConfig({ ...minimal, cast: { receiver: "ABCDEF12" } })).toThrow("cast");
  });

  it("names the plugin in the error so a developer finds it", () => {
    expect(() => parseShellConfig({})).toThrow("@open-game-system/shell");
  });

  it("rejects a missing config", () => {
    expect(() => parseShellConfig(undefined)).toThrow("@open-game-system/shell");
  });
});
