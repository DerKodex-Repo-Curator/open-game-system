import { describe, expect, it } from "vitest";
import { CATALOGUE, catalogueFor } from "../src/catalogue";

describe("local start URL overrides (dev / e2e only)", () => {
  it("without CATALOGUE_START_URLS the catalogue is the deployed one", () => {
    expect(catalogueFor({})).toBe(CATALOGUE);
    expect(catalogueFor({ CATALOGUE_START_URLS: "" })).toBe(CATALOGUE);
  });

  it("points a game at a local server", () => {
    const games = catalogueFor({
      CATALOGUE_START_URLS: JSON.stringify({ "rocket-crew": "http://localhost:8821/" }),
    });
    expect(games.find((g) => g.appId === "rocket-crew")?.startUrl).toBe("http://localhost:8821/");
    expect(games.find((g) => g.appId === "story-nook")?.startUrl).toBe(
      "https://story-nook.jonathanrmumm.workers.dev/",
    );
    expect(games.map((g) => g.appId)).toEqual(CATALOGUE.map((g) => g.appId));
  });

  it.each([
    "not json",
    "[1]",
    '{"rocket-crew":"not a url"}',
    '{"rocket-crew":3}',
  ])("ignores a malformed override %j", (raw) => {
    expect(catalogueFor({ CATALOGUE_START_URLS: raw })).toBe(CATALOGUE);
  });

  it("an override can't add a game", () => {
    const games = catalogueFor({
      CATALOGUE_START_URLS: JSON.stringify({ "word-duel": "http://localhost:9/" }),
    });
    expect(games.map((g) => g.appId)).toEqual(CATALOGUE.map((g) => g.appId));
  });
});
