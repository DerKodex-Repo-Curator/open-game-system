import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// `plugins: [["@open-game-system/shell", {...}]]` loads app.plugin.js, which loads plugin/build
// (the test script builds it first).
const require = createRequire(__filename);
const PluginSchema = z.custom<(config: unknown, props: unknown) => unknown>(
  (value) => typeof value === "function",
);
const ConfigSchema = z.object({
  ios: z.object({ associatedDomains: z.array(z.string()) }),
  _internal: z.object({ pluginHistory: z.record(z.string(), z.unknown()) }),
});

describe("app.plugin.js", () => {
  it("is withOgsShell", { timeout: 30_000 }, () => {
    const plugin = PluginSchema.parse(require("../../../app.plugin.js"));
    const config = ConfigSchema.parse(
      plugin(
        {
          name: "Rocket Crew",
          slug: "rocket-crew",
          plugins: ["expo-apple-authentication"],
          _internal: { projectRoot: path.resolve(__dirname, "../../..") },
        },
        { appId: "rocket-crew", gameUrl: "https://rocketcrew.tv/play", name: "Rocket Crew" },
      ),
    );
    expect(config.ios.associatedDomains).toEqual(["applinks:opengame.org"]);
    expect(Object.keys(config._internal.pluginHistory)).toContain("@open-game-system/shell");
  });
});
