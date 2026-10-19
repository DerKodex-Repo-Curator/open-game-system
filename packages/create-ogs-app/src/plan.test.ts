import { describe, expect, it } from "vitest";
import type { Answers } from "./options";
import { ASSETS, planFiles } from "./plan";

const answers: Answers = {
  dir: "app",
  appId: "rocket-crew",
  name: "Rocket Crew",
  gameUrl: "https://rocketcrew.tv/phone",
  bundleId: "tv.rocketcrew.app",
  androidPackage: "tv.rocketcrew.app",
  teamId: "34S957HD77",
  linkDomains: ["rocketcrew.tv"],
  branding: "hidden",
  shellVersion: "^0.1.0",
};

const template = [
  "README.md",
  "app.config.ts",
  "app/_layout.tsx",
  "gitignore",
  "npmrc",
  "link-files/_well-known/apple-app-site-association",
  "link-files/_well-known/assetlinks.json",
  "link-files/README.md",
  ".DS_Store",
  "app/.DS_Store",
  "node_modules/x/index.js",
];

const targets = (files: ReturnType<typeof planFiles>) => files.map((f) => f.to);

describe("planFiles", () => {
  it("renders every template file and adds the generated assets, sorted", () => {
    const plan = planFiles(template, answers);
    expect(targets(plan)).toEqual([
      ".gitignore",
      ".npmrc",
      "README.md",
      "app.config.ts",
      "app/_layout.tsx",
      "assets/adaptive-icon.png",
      "assets/icon.png",
      "assets/splash-icon.png",
      "link-files/.well-known/apple-app-site-association",
      "link-files/.well-known/assetlinks.json",
      "link-files/README.md",
    ]);
  });

  it("says where each file comes from", () => {
    const plan = planFiles(template, answers);
    expect(plan.find((f) => f.to === ".gitignore")?.source).toEqual({
      kind: "template",
      from: "gitignore",
    });
    expect(plan.find((f) => f.to === "assets/icon.png")?.source).toEqual({
      kind: "asset",
      asset: "icon",
    });
    expect(ASSETS.map((a) => a.path)).toEqual([
      "assets/icon.png",
      "assets/adaptive-icon.png",
      "assets/splash-icon.png",
    ]);
  });

  it("leaves out the link files when the app has no link domain of its own", () => {
    const plan = planFiles(template, { ...answers, linkDomains: [] });
    expect(targets(plan).some((t) => t.startsWith("link-files/"))).toBe(false);
    expect(targets(plan)).toContain("README.md");
  });

  it("accepts Windows separators from a directory walk", () => {
    expect(targets(planFiles(["app\\index.tsx"], answers))).toContain("app/index.tsx");
  });

  it("refuses a template file where a generated asset goes", () => {
    expect(() => planFiles(["assets/icon.png"], answers)).toThrow(/assets\/icon\.png/);
  });
});

describe("planFiles order", () => {
  it("sorts whatever order the directory walk gives", () => {
    const shuffled = ["z.md", "b/a.ts", "a.ts", "b.ts", "assets-notes.md"];
    expect(targets(planFiles(shuffled, answers))).toEqual([
      "a.ts",
      "assets-notes.md",
      "assets/adaptive-icon.png",
      "assets/icon.png",
      "assets/splash-icon.png",
      "b.ts",
      "b/a.ts",
      "z.md",
    ]);
    expect(targets(planFiles([...shuffled].reverse(), answers))).toEqual(
      targets(planFiles(shuffled, answers)),
    );
  });
});
