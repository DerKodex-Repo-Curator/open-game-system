import { describe, expect, it } from "vitest";
import { nativeConfigFor } from "../native-config";
import { parseShellConfig } from "../shell-config";

const base = {
  appId: "rocket-crew",
  gameUrl: "https://rocketcrew.tv/play",
  name: "Rocket Crew",
};

describe("apiBase and tvBase (a preview OGS API for e2e)", () => {
  it("are optional: without them the plugin writes neither and the runtime uses production", () => {
    const ogsShell = nativeConfigFor(parseShellConfig(base)).extra.ogsShell;
    expect("apiBase" in ogsShell).toBe(false);
    expect("tvBase" in ogsShell).toBe(false);
  });

  it("are written to extra.ogsShell when given", () => {
    const config = parseShellConfig({
      ...base,
      apiBase: "https://opengame-api-pr-shell.jonathanrmumm.workers.dev",
      tvBase: "https://shell.ogs-tv.pages.dev",
    });
    expect(nativeConfigFor(config).extra.ogsShell).toMatchObject({
      apiBase: "https://opengame-api-pr-shell.jonathanrmumm.workers.dev",
      tvBase: "https://shell.ogs-tv.pages.dev",
    });
  });

  it("each can be given alone", () => {
    const ogsShell = nativeConfigFor(
      parseShellConfig({ ...base, apiBase: "http://localhost:8787" }),
    ).extra.ogsShell;
    expect(ogsShell).toMatchObject({ apiBase: "http://localhost:8787" });
    expect("tvBase" in ogsShell).toBe(false);
  });

  it("must be http(s) URLs", () => {
    expect(() => parseShellConfig({ ...base, apiBase: "opengame-api.example" })).toThrow(/apiBase/);
    expect(() => parseShellConfig({ ...base, tvBase: "ftp://tv.example" })).toThrow(/tvBase/);
  });
});
