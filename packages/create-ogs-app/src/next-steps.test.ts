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
      "ogs login --app rocket-crew --key <your game API key, ogsk_…>",
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

describe("nextSteps, word for word", () => {
  it("with a link domain", () => {
    expect(nextSteps(answers, "app")).toMatchInlineSnapshot(`
      "Your app is in app. Next:

        cd app
        pnpm install
        pnpm ios                 # or: pnpm android (a development build on a simulator/emulator)

      Tell OGS about the app (pnpm add -g @open-game-system/cli):

        ogs login --app rocket-crew --key <your game API key, ogsk_…>
        ogs apps register --ios tv.rocketcrew.app --team-id 34S957HD77
        ogs apps register --android tv.rocketcrew.app --sha256 <from eas credentials> --google-client-id <id>
        ogs push credentials --ios AuthKey_<KEYID>.p8 --key-id <KEYID> --team-id 34S957HD77
        ogs push credentials --android service-account.json

      Build and ship:

        eas build --profile preview --platform ios      # TestFlight-ready
        eas submit --profile preview --platform ios
        ogs doctor --domain rocketcrew.tv

      Links: serve link-files/.well-known/ at https://rocketcrew.tv/.well-known/apple-app-site-association
      and /.well-known/assetlinks.json (fill in the SHA-256 from \`eas credentials\`).
      opengame.org/play/rocket-crew/… opens the app too.

      README.md walks through all of it; REVIEW_NOTES.md is your App Review note."
    `);
  });

  it("without one", () => {
    expect(nextSteps({ ...answers, linkDomains: [] }, "app")).toMatchInlineSnapshot(`
      "Your app is in app. Next:

        cd app
        pnpm install
        pnpm ios                 # or: pnpm android (a development build on a simulator/emulator)

      Tell OGS about the app (pnpm add -g @open-game-system/cli):

        ogs login --app rocket-crew --key <your game API key, ogsk_…>
        ogs apps register --ios tv.rocketcrew.app --team-id 34S957HD77
        ogs apps register --android tv.rocketcrew.app --sha256 <from eas credentials> --google-client-id <id>
        ogs push credentials --ios AuthKey_<KEYID>.p8 --key-id <KEYID> --team-id 34S957HD77
        ogs push credentials --android service-account.json

      Build and ship:

        eas build --profile preview --platform ios      # TestFlight-ready
        eas submit --profile preview --platform ios
        ogs doctor

      Links: https://opengame.org/play/rocket-crew/… opens the app (add your own domain later).

      README.md walks through all of it; REVIEW_NOTES.md is your App Review note."
    `);
  });
});
