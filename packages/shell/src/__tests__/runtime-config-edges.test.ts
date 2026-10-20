import { readRuntimeConfig } from "../runtime-config";

const shell = {
  appId: "rocket-crew",
  gameUrl: "https://play.rocketcrew.tv/phone",
  linkDomains: [],
};
const config = (ogsShell: Record<string, unknown>) => ({
  name: "Rocket Crew",
  extra: { ogsShell: { ...shell, ...ogsShell } },
});

describe("readRuntimeConfig, edges", () => {
  it("names the whole config when there is none, and lists every problem", () => {
    expect(() => readRuntimeConfig(null)).toThrow("(expo config): ");
    expect(() => readRuntimeConfig({ extra: { ogsShell: { appId: "" } } })).toThrow(/; /);
  });

  it("wants an https:// game URL, starting the string", () => {
    expect(() => readRuntimeConfig(config({ gameUrl: "see https://rocketcrew.tv" }))).toThrow(
      "an https:// URL",
    );
  });

  it("hides the branding unless told otherwise", () => {
    expect(readRuntimeConfig(config({})).branding).toBe("hidden");
  });

  it("takes an http:// API or TV base (a local stack), but only at the start", () => {
    const local = readRuntimeConfig(
      config({ apiBase: "http://localhost:8787", tvBase: "http://localhost:5174" }),
    );
    expect(local.apiBase).toBe("http://localhost:8787");
    expect(local.tvBase).toBe("http://localhost:5174");
    expect(() => readRuntimeConfig(config({ apiBase: "api http://localhost" }))).toThrow();
    expect(() => readRuntimeConfig(config({ tvBase: "tv http://localhost" }))).toThrow();
  });
});
