import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { by, device, element, waitFor } from "detox";

// Acceptance: 2026-10-17-browser-tv.feature. A household with no Chromecast: a laptop on the TV
// opens the TV page, which shows a code; the phone's cast prompt finds no TV, offers "Use a browser
// TV", pairs with the code, and Cast starts the game there. Stop casting puts the code back.
//
// The "laptop" is the fake Chromecast's browser (FAKE_CAST), opened at the TV page in screen mode.
// Needs a build with EXPO_PUBLIC_FAKE_CAST=none (no Chromecast), the local API (E2E_OGS_API) and
// the launcher (OGS_TV) built from this branch.
const API = process.env.E2E_OGS_API ?? "http://localhost:8788";
const TV = process.env.OGS_TV ?? "http://localhost:5180";
const CAST = process.env.FAKE_CAST ?? "http://localhost:5181";
const GAME = process.env.FUNNEL_GAME ?? "bake-shop";
const WALK_MS = 300_000;

type Dom = {
  screen: string | null;
  frameApp: string | null;
  starting: boolean;
  screenCode: string | null;
};
const tv = async (): Promise<{ dom: Dom | null }> =>
  (await fetch(`${CAST}/launcher`)).json() as Promise<{ dom: Dom | null }>;
async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms: number): Promise<T> {
  const stop = Date.now() + ms;
  let last = await read();
  while (!ok(last) && Date.now() < stop) {
    await new Promise((r) => setTimeout(r, 300));
    last = await read();
  }
  return last;
}
async function shot(name: string) {
  const path = await device.takeScreenshot(name);
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  copyFileSync(path, join(dir, `${name}.png`));
}
const visible = (id: string, ms = 10000) =>
  waitFor(element(by.id(id)))
    .toBeVisible()
    .withTimeout(ms);

async function onboard(name: string) {
  await visible("onboardingMakeProfile", 30000);
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
    .withTimeout(10000);
  await waitFor(element(by.id("profileNext")))
    .toBeVisible()
    .whileElement(by.id("profileStep"))
    .scroll(150, "down");
  await element(by.id("profileNext")).tap();
  await visible("profileDoneGreeting");
  await element(by.id("onboardingLetsGoButton")).tap();
}

describe("No Chromecast: a browser on the TV", () => {
  it(
    "pairs with the code it shows, plays the game there, and shows the code again on stop",
    async () => {
      await device.launchApp({
        newInstance: true,
        delete: true,
        permissions: { notifications: "NO" },
      });
      await onboard("Dana");

      // The laptop on the TV opens the TV page: a screen with a code. (A fresh browser: the fake's
      // /stop closes its context, so no screen from an earlier run is remembered.)
      await fetch(`${CAST}/stop`, { method: "POST" });
      await fetch(`${CAST}/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewUrl: `${TV}/?screen=1&api=${encodeURIComponent(API)}` }),
      });
      const waiting = await until(tv, (t) => /^[A-Z2-9]{6}$/.test(t.dom?.screenCode ?? ""), 20000);
      const code = waiting.dom?.screenCode ?? "";
      if (!code) throw new Error(`the TV page shows no code: ${JSON.stringify(waiting.dom)}`);

      // Play: no Chromecast, so the prompt offers a browser TV.
      await waitFor(element(by.id("libraryScreen")))
        .toExist()
        .withTimeout(15000);
      await waitFor(element(by.id(`libraryGame-${GAME}`)))
        .toBeVisible()
        .whileElement(by.id("libraryScreen"))
        .scroll(200, "down");
      await element(by.id(`libraryGame-${GAME}`)).tap();
      await visible("gamePlay");
      await element(by.id("gamePlay")).tap();
      // The no-TV view sits in the sheet's scroll view (Detox's 75% visibility check can't see it).
      await waitFor(element(by.id("castPromptNoTv")))
        .toExist()
        .withTimeout(15000);
      await shot("browser-tv-01-no-tv");
      await waitFor(element(by.id("browserTvOpen")))
        .toBeVisible()
        .whileElement(by.id("castPromptScroll"))
        .scroll(150, "down");
      await element(by.id("browserTvOpen")).tap();
      await visible("browserTvCode");
      await element(by.id("browserTvCode")).typeText(code.toLowerCase());
      await element(by.id("browserTvCode")).tapReturnKey();
      await visible("castPromptConfirm", 10000);
      await shot("browser-tv-02-paired");
      await element(by.id("castPromptConfirm")).tap();

      const started = await until(
        tv,
        (t) => t.dom?.screen === "game" && (t.dom.starting || t.dom.frameApp === GAME),
        30000,
      );
      if (started.dom?.screen !== "game")
        throw new Error(`the browser TV never started ${GAME}: ${JSON.stringify(started.dom)}`);
      await shot("browser-tv-03-playing");

      // Stop casting: swipe back out of the game, then the TV tab's Stop; the browser TV shows its
      // code again.
      await visible("swipeHintOverlay", 15000);
      await element(by.id("swipeHintOverlay")).swipe("right", "fast", 0.8, 0.02, 0.5);
      await waitFor(element(by.id("gamePage")))
        .toExist()
        .withTimeout(5000);
      await element(by.id("tabTV")).tap();
      await visible("remoteEnd", 15000);
      await element(by.id("remoteEnd")).tap();
      await visible("remoteEndConfirm");
      await element(by.id("remoteEndConfirm")).tap();
      const back = await until(tv, (t) => t.dom?.screenCode === code, 15000);
      if (back.dom?.screenCode !== code)
        throw new Error(`the browser TV didn't go back to its code: ${JSON.stringify(back.dom)}`);
    },
    WALK_MS,
  );
});
