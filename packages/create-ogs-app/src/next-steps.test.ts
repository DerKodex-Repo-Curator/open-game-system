import { describe, expect, it } from "vitest";
import { HELP, nextSteps } from "./next-steps";
import type { Answers } from "./options";

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

describe("nextSteps", () => {
  const text = nextSteps(answers, "app");

  it("goes in order: install, run, log in, register, push credentials, build, submit, doctor", () => {
    const order = [
      "cd app",
      "pnpm install",
      "pnpm ios",
      "ogs login --app rocket-crew",
      "ogs apps register --ios tv.rocketcrew.app --team-id 34S957HD77",
      "ogs apps register --android tv.rocketcrew.app",
      "ogs push credentials --ios",
      "ogs push credentials --android",
      "eas build --profile preview --platform ios",
      "eas submit --profile preview --platform ios",
      "ogs doctor --domain rocketcrew.tv",
    ];
    let at = 0;
    for (const step of order) {
      const i = text.indexOf(step, at);
      expect(i, step).toBeGreaterThanOrEqual(at);
      at = i;
    }
  });

  it("points at the link files for the developer's own domain", () => {
    expect(text).toContain("link-files/.well-known");
    expect(text).toContain("https://rocketcrew.tv/.well-known/apple-app-site-association");
  });

  it("without a link domain, says links go through opengame.org", () => {
    const none = nextSteps({ ...answers, linkDomains: [] }, "app");
    expect(none).not.toContain("link-files");
    expect(none).toContain("https://opengame.org/play/rocket-crew/");
    expect(none).toContain("ogs doctor\n");
  });

  it("quotes a directory with spaces", () => {
    expect(nextSteps(answers, "my games/rocket app")).toContain('cd "my games/rocket app"');
  });

  it("names the README and REVIEW_NOTES", () => {
    expect(text).toContain("README.md");
    expect(text).toContain("REVIEW_NOTES.md");
  });
});

describe("HELP", () => {
  it("lists every flag", () => {
    for (const flag of [
      "--app-id",
      "--name",
      "--game-url",
      "--bundle-id",
      "--package",
      "--team-id",
      "--link-domain",
      "--no-link-domain",
      "--branding",
      "--shell-version",
      "--yes",
      "--help",
    ]) {
      expect(HELP).toContain(flag);
    }
    expect(HELP).toContain("pnpm create ogs-app");
  });
});
