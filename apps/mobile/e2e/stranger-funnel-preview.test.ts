import { by, device, element, waitFor, web } from "detox";

// The whole stranger funnel against the preview stack (docs/funnel-audit.md), the host's phone half.
// The orchestrator, e2e/stranger-funnel-preview.ts, drives the browsers (the front door, the TV, the
// guest's phone) and this test over FUNNEL_COORD: GET /wait/<step> blocks until the step is posted.
//
// Build: EXPO_PUBLIC_OGS_API=<preview API>, EXPO_PUBLIC_OGS_TV=<preview launcher>,
// EXPO_PUBLIC_FAKE_CAST=none (no Chromecast in this household). Run it through the orchestrator.
const COORD = process.env.FUNNEL_COORD ?? "http://localhost:5391";
const WALK_MS = 600_000;

async function step(name: string, body: unknown = {}): Promise<void> {
  await fetch(`${COORD}/step/${name}`, { method: "POST", body: JSON.stringify(body) });
}
async function wait(name: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${COORD}/wait/${name}`);
    if (res.status === 200) return (await res.json()) as Record<string, unknown>;
  }
  throw new Error(`the orchestrator never said ${name}`);
}
const str = (v: unknown, what: string): string => {
  if (typeof v !== "string") throw new Error(`no ${what}`);
  return v;
};
const visible = (id: string, ms = 15000) =>
  waitFor(element(by.id(id)))
    .toBeVisible()
    .withTimeout(ms);

/** Runs `fn` (a function of the matched element, as source) in the game's page in the WebView. */
async function inGame(selector: string, fn: string): Promise<unknown> {
  return web.element(by.web.cssSelector(selector)).runScript(fn);
}
/** Waits until the game's page has `selector`. */
async function untilInGame(selector: string, ms = 30000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      await inGame(selector, "(el) => el.tagName");
      return;
    } catch (err) {
      if (Date.now() > end) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

describe("A stranger household on the preview, from the catalogue to the first round", () => {
  it(
    "the host: catalogue link → profile → browser TV → Rocket Crew as Captain",
    async () => {
      const appLink = str((await wait("app-link")).url, "app link");
      await device.launchApp({
        newInstance: true,
        delete: true,
        permissions: { notifications: "NO" },
        url: appLink,
      });

      // Onboarding (the link waits for it), then the game's page.
      await visible("onboardingMakeProfile", 30000);
      await element(by.id("onboardingMakeProfile")).tap();
      await visible("onboardingMaybeLaterButton");
      await element(by.id("onboardingMaybeLaterButton")).tap();
      await visible("profileNameInput");
      await element(by.id("profileNameInput")).typeText("Dana");
      await element(by.id("profileNameInput")).tapReturnKey();
      await waitFor(element(by.id("profileHandleStatus")))
        .toHaveText("free")
        .withTimeout(15000);
      await waitFor(element(by.id("profileNext")))
        .toBeVisible()
        .whileElement(by.id("profileStep"))
        .scroll(150, "down");
      await element(by.id("profileNext")).tap();
      await visible("onboardingLetsGoButton");
      await element(by.id("onboardingLetsGoButton")).tap();
      await waitFor(element(by.id("gamePage")))
        .toExist()
        .withTimeout(20000);
      await step("onboarded");

      // No Chromecast: the TV tab's browser TV, with the code the TV page shows.
      await element(by.id("tabTV")).tap();
      await waitFor(element(by.id("browserTvOpen")))
        .toBeVisible()
        .whileElement(by.id("tvNotCast"))
        .scroll(200, "down");
      await element(by.id("browserTvOpen")).tap();
      const code = str((await wait("tv-code")).code, "TV code");
      await element(by.id("browserTvCode")).typeText(code);
      await element(by.id("browserTvCode")).tapReturnKey();
      await waitFor(element(by.id("castButton")))
        .toBeVisible()
        .whileElement(by.id("tvNotCast"))
        .scroll(200, "up");
      await element(by.id("castButton")).tap();
      await visible("remoteOk", 30000);
      await step("cast");

      // The guest joins from the TV's QR; then Dana starts Rocket Crew.
      await wait("guest-on-couch");
      // The Library tab still has Rocket Crew's page on top (where the catalogue link landed).
      await element(by.id("tabLibrary")).tap();
      await visible("gamePlay");
      await element(by.id("gamePlay")).tap();
      await waitFor(element(by.id("gameScreen")))
        .toExist()
        .withTimeout(30000);
      await step("host-in-game");

      // Captain: Ready, then read the first problem's line aloud (to the orchestrator).
      await untilInGame(".captain", 60000);
      await untilInGame("body");
      // Ready asks iOS for motion (it needs a real touch, not a scripted click): tap where the button
      // is, then answer the motion prompt either way (Rocket Crew falls back to taps without it).
      const readyAt = `(body) => { const b = [...body.querySelectorAll("button")].find((x) => x.textContent.trim() === "Ready"); if (!b) return ""; const r = b.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }); }`;
      // The first visit's "Swipe to go home" hint covers the game until it is tapped.
      try {
        await waitFor(element(by.id("swipeHintOverlay")))
          .toBeVisible()
          .withTimeout(5000);
        await element(by.id("swipeHintOverlay")).tap();
      } catch {}
      for (let tries = 0; tries < 4; tries++) {
        const at = await inGame("body", readyAt);
        if (typeof at !== "string" || !at) break;
        const point: unknown = JSON.parse(at);
        if (typeof point !== "object" || point === null || !("x" in point) || !("y" in point))
          break;
        // A screen tap (the WebView fills the screen): the first one also dismisses a covering hint.
        await device.tap({ x: Number(point.x), y: Number(point.y) });
        for (const answer of ["Allow", "OK", "Cancel"]) {
          try {
            await waitFor(element(by.label(answer)))
              .toBeVisible()
              .withTimeout(1500);
            await element(by.label(answer)).tap();
            break;
          } catch {}
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      await step("captain-ready");
      await wait("launched");
      await untilInGame(".line", 30000);
      const line = await inGame(".line", "(el) => el.textContent");
      await step("captain-line", { line: str(line, "captain line") });
      await wait("round-done");
    },
    WALK_MS,
  );
});
