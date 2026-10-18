import { describe, expect, it } from "vitest";
import type { Answers } from "./options";
import {
  brandColor,
  findPlaceholders,
  PLACEHOLDER_NAMES,
  placeholderValues,
  renderTemplate,
} from "./placeholders";

const rocketCrew: Answers = {
  dir: "app",
  appId: "rocket-crew",
  name: "Rocket Crew",
  gameUrl: "https://rocketcrew.tv/phone",
  bundleId: "tv.rocketcrew.app",
  androidPackage: "tv.rocketcrew.app",
  teamId: "34S957HD77",
  linkDomains: ["rocketcrew.tv", "play.rocketcrew.tv"],
  branding: "hidden",
  shellVersion: "^0.1.0",
};

describe("placeholderValues", () => {
  it("fills every placeholder from the answers", () => {
    const values = placeholderValues(rocketCrew);
    expect(values).toEqual({
      APP_ID: "rocket-crew",
      APP_NAME: "Rocket Crew",
      GAME_URL: "https://rocketcrew.tv/phone",
      GAME_ORIGIN: "https://rocketcrew.tv",
      BUNDLE_ID: "tv.rocketcrew.app",
      ANDROID_PACKAGE: "tv.rocketcrew.app",
      APPLE_TEAM_ID: "34S957HD77",
      LINK_DOMAINS: '["rocketcrew.tv", "play.rocketcrew.tv"]',
      LINK_BASE: "https://rocketcrew.tv",
      BRANDING: "hidden",
      SHELL_VERSION: "^0.1.0",
      BRAND_COLOR: brandColor("rocket-crew"),
    });
    expect(Object.keys(values).sort()).toEqual([...PLACEHOLDER_NAMES].sort());
  });

  it("without a link domain, links go through opengame.org/play/<appId>", () => {
    const values = placeholderValues({ ...rocketCrew, linkDomains: [] });
    expect(values.LINK_DOMAINS).toBe("[]");
    expect(values.LINK_BASE).toBe("https://opengame.org/play/rocket-crew");
  });
});

describe("brandColor", () => {
  it("is a stable hex color per app id, different between apps", () => {
    expect(brandColor("rocket-crew")).toMatch(/^#[0-9a-f]{6}$/);
    expect(brandColor("rocket-crew")).toBe(brandColor("rocket-crew"));
    expect(brandColor("rocket-crew")).not.toBe(brandColor("codebreakers"));
  });
});

describe("renderTemplate", () => {
  const values = placeholderValues(rocketCrew);

  it("replaces every placeholder, as often as it appears", () => {
    expect(
      renderTemplate("id __OGS_APP_ID__, again __OGS_APP_ID__ for __OGS_APP_NAME__", values),
    ).toBe("id rocket-crew, again rocket-crew for Rocket Crew");
  });

  it("leaves JSX double braces and other text alone", () => {
    const tsx = "<View style={{ flex: 1 }} />\n// __init__ and __dirname";
    expect(renderTemplate(tsx, values)).toBe(tsx);
  });

  it("refuses a placeholder it doesn't know, naming it", () => {
    expect(() => renderTemplate("__OGS_APP_ID__ __OGS_NOPE__", values)).toThrow(/__OGS_NOPE__/);
  });

  it("does not re-read what it put in", () => {
    const sneaky = placeholderValues({ ...rocketCrew, name: "__OGS_APP_ID__" });
    expect(renderTemplate("__OGS_APP_NAME__", sneaky)).toBe("__OGS_APP_ID__");
  });
});

describe("findPlaceholders", () => {
  it("lists the placeholders left in a text", () => {
    expect(findPlaceholders("a __OGS_APP_ID__ b __OGS_X__ __OGS_APP_ID__")).toEqual([
      "__OGS_APP_ID__",
      "__OGS_X__",
    ]);
    expect(findPlaceholders("style={{ a: 1 }}")).toEqual([]);
  });
});

describe("brandColor, exactly", () => {
  it("pins the colors (icons stay the same across versions)", () => {
    expect(
      ["rocket-crew", "codebreakers", "a", "trivia-jam"].map(brandColor),
    ).toMatchInlineSnapshot(`
      [
        "#29698e",
        "#4b298e",
        "#508e29",
        "#308e29",
      ]
    `);
  });
});
