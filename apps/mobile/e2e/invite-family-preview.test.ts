import { by, device, element, waitFor } from "detox";
import { z } from "zod";

// Invite another family across two households on the preview (2026-10-18-invite-another-family
// .feature), the phones' half: Dana's household plays and stops, then invites; the Lees' phone (a
// fresh install of the same simulator) opens the invite's app link, onboards and casts its first
// couch. The orchestrator, e2e/invite-family-preview.ts, drives the browsers and checks the funnel.
const COORD = process.env.FUNNEL_COORD ?? "http://localhost:5392";
const WALK_MS = 1_800_000;

async function step(name: string, body: unknown = {}): Promise<void> {
  await fetch(`${COORD}/step/${name}`, { method: "POST", body: JSON.stringify(body) });
}
async function wait(name: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 90; i++) {
    const res = await fetch(`${COORD}/wait/${name}`);
    if (res.status === 200) return z.record(z.string(), z.unknown()).parse(await res.json());
  }
  throw new Error(`the orchestrator never said ${name}`);
}
const str = (v: unknown, what: string): string => {
  if (typeof v !== "string") throw new Error(`no ${what}`);
  return v;
};
const visible = (id: string, ms = 20000) =>
  waitFor(element(by.id(id)))
    .toBeVisible()
    .withTimeout(ms);

async function onboard(name: string) {
  await visible("onboardingMakeProfile", 60000);
  await element(by.id("onboardingMakeProfile")).tap();
  // Onboarding's notifications page only shows while notifications are undecided (Android may
  // have them on already: the page is skipped).
  try {
    await waitFor(element(by.id("onboardingMaybeLaterButton")))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id("onboardingMaybeLaterButton")).tap();
  } catch {}
  await visible("profileNameInput");
  await element(by.id("profileNameInput")).typeText(name);
  await element(by.id("profileNameInput")).tapReturnKey();
  await waitFor(element(by.id("profileHandleStatus")))
    .toHaveText("free")
    .withTimeout(20000);
  await waitFor(element(by.id("profileNext")))
    .toBeVisible()
    .whileElement(by.id("profileStep"))
    .scroll(150, "down");
  await element(by.id("profileNext")).tap();
  await visible("onboardingLetsGoButton");
  await element(by.id("onboardingLetsGoButton")).tap();
}

/** TV tab › Use a browser TV › the code the orchestrator's TV page shows › Cast. */
async function castToBrowserTv(codeStep: string) {
  await element(by.id("tabTV")).tap();
  await waitFor(element(by.id("browserTvOpen")))
    .toBeVisible()
    .whileElement(by.id("tvNotCast"))
    .scroll(200, "down");
  await element(by.id("browserTvOpen")).tap();
  const code = str((await wait(codeStep)).code, "TV code");
  await element(by.id("browserTvCode")).typeText(code);
  await element(by.id("browserTvCode")).tapReturnKey();
  await waitFor(element(by.id("castButton")))
    .toBeVisible()
    .whileElement(by.id("tvNotCast"))
    .scroll(200, "up");
  await element(by.id("castButton")).tap();
  await visible("remoteOk", 60000);
}

describe("Invite another family, across two households (preview)", () => {
  it(
    "Dana plays, stops and invites; the Lees come in through the invite and cast",
    async () => {
      // Household 1: Dana.
      await device.launchApp({
        newInstance: true,
        delete: true,
        permissions: { notifications: "NO" },
      });
      await onboard("Dana");
      await waitFor(element(by.id("libraryScreen")))
        .toExist()
        .withTimeout(30000);
      await castToBrowserTv("dana-tv-code");
      // A game tonight: Rocket Crew (opening it is a sitting), then back to the TV tab.
      await element(by.id("tabLibrary")).tap();
      await waitFor(element(by.id("libraryGame-rocket-crew")))
        .toBeVisible()
        .whileElement(by.id("libraryScreen"))
        .scroll(200, "down");
      await element(by.id("libraryGame-rocket-crew")).tap();
      await visible("gamePlay");
      await element(by.id("gamePlay")).tap();
      await waitFor(element(by.id("gameScreen")))
        .toExist()
        .withTimeout(60000);
      await step("dana-played");
      try {
        await visible("swipeHintOverlay", 15000);
        await element(by.id("swipeHintOverlay")).swipe("right", "fast", 0.8, 0.02, 0.5);
      } catch {
        await element(by.id("gameScreen")).swipe("right", "fast", 0.8, 0.02, 0.5);
      }
      await waitFor(element(by.id("gamePage")))
        .toExist()
        .withTimeout(15000);
      // The end of the session: Stop casting, then Invite another family.
      await element(by.id("tabTV")).tap();
      await visible("remoteEnd", 30000);
      await element(by.id("remoteEnd")).tap();
      await visible("remoteEndConfirm");
      await element(by.id("remoteEndConfirm")).tap();
      await waitFor(element(by.id("inviteFamilyOpen")))
        .toBeVisible()
        .whileElement(by.id("tvNotCast"))
        .scroll(150, "down");
      await element(by.id("inviteFamilyOpen")).tap();
      // The share sheet opens over it: close it like a person who copies the link instead.
      try {
        await waitFor(element(by.label("Close")))
          .toExist()
          .withTimeout(8000);
        await element(by.label("Close")).tap();
      } catch {}
      await waitFor(element(by.id("inviteFamilyLink")))
        .toExist()
        .withTimeout(20000);
      const attrs = await element(by.id("inviteFamilyLink")).getAttributes();
      const link = "text" in attrs && typeof attrs.text === "string" ? attrs.text : "";
      await step("invite-link", { link });

      // Household 2: the Lees install OGS and open the invite's app link from its page.
      const appLink = str((await wait("lee-app-link")).url, "the Lees' app link");
      await device.launchApp({
        newInstance: true,
        delete: true,
        permissions: { notifications: "NO" },
        url: appLink,
      });
      await onboard("Lee");
      await waitFor(element(by.id("gamePage")))
        .toExist()
        .withTimeout(30000);
      await castToBrowserTv("lee-tv-code");
      await step("lee-cast");
      await wait("done");
    },
    WALK_MS,
  );
});
