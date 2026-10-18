import { by, device, element, waitFor, web } from "detox";
import { z } from "zod";

// The second visit on the preview (docs/acceptance/2026-10-18-second-visit.feature), the host's
// phone. Day 1: Dana onboards, casts to the browser TV, plays a round of Rocket Crew, closes the
// app. Day 2 (the phone's clock a day ahead: an EXPO_PUBLIC_E2E_CLOCK=1 build reads the launch
// argument ogsClockOffsetMs): she opens OGS, casts (the TV is remembered), presses OK on the TV's
// Play again, and plays the first round. The orchestrator is e2e/second-visit-preview.ts.
const COORD = process.env.FUNNEL_COORD ?? "http://localhost:5393";
const DAY = 24 * 60 * 60 * 1000;
const WALK_MS = 2_400_000;

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
const visible = (id: string, ms = 30000) =>
  waitFor(element(by.id(id)))
    .toBeVisible()
    .withTimeout(ms);

/** Dana's taps on day 2, counted as she makes them. */
let taps = 0;
async function tap(id: string) {
  taps++;
  await element(by.id(id)).tap();
}

async function inGame(selector: string, fn: string): Promise<unknown> {
  return web.element(by.web.cssSelector(selector)).runScript(fn);
}
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

/** The Captain's round, from the game screen: Ready (a real touch), then read the first line. */
async function captainRound(suffix: string) {
  // A running game never lets the app go idle: Espresso Web (Android) waits for idle before every
  // script. The steps below poll for themselves.
  await device.disableSynchronization();
  await untilInGame(".captain", 60000);
  const readyAt = `(captain) => { const b = [...captain.ownerDocument.querySelectorAll("button")].find((x) => x.textContent.trim() === "Ready"); if (!b) return ""; const r = b.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }); }`;
  try {
    await waitFor(element(by.id("swipeHintOverlay")))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id("swipeHintOverlay")).tap();
  } catch {}
  for (let tries = 0; tries < 4; tries++) {
    const at = await inGame(".captain", readyAt);
    if (typeof at !== "string" || !at) break;
    const point: unknown = JSON.parse(at);
    if (typeof point !== "object" || point === null || !("x" in point) || !("y" in point)) break;
    const tapAt = { x: Number(point.x), y: Number(point.y) };
    if (tries === 0) taps++;
    if (device.getPlatform() === "android") await element(by.id("gameWebView")).tap(tapAt);
    else await device.tap(tapAt);
    try {
      await waitFor(element(by.text("Allow")))
        .toExist()
        .withTimeout(10000);
      await element(by.text("Allow")).tap();
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  await step(`captain-ready${suffix}`);
  await wait(`launched${suffix}`);
  await untilInGame(".line", 30000);
  const line = await inGame(".line", "(el) => el.textContent");
  await step(`captain-line${suffix}`, { line: str(line, "captain line") });
  await wait(`round-done${suffix}`);
  // Synchronization stays off: the game is still running (the app is closed next, or the walk ends).
}

describe("The second visit (preview)", () => {
  it(
    "day 1 plays a round; day 2, a day later, is back in a round in a few taps",
    async () => {
      // --- Day 1 ---------------------------------------------------------------------------------
      await device.launchApp({
        newInstance: true,
        delete: true,
        permissions: { notifications: "NO" },
      });
      await visible("onboardingMakeProfile", 60000);
      await element(by.id("onboardingMakeProfile")).tap();
      try {
        await waitFor(element(by.id("onboardingMaybeLaterButton")))
          .toBeVisible()
          .withTimeout(5000);
        await element(by.id("onboardingMaybeLaterButton")).tap();
      } catch {}
      await visible("profileNameInput");
      await element(by.id("profileNameInput")).typeText("Dana");
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
      await waitFor(element(by.id("libraryScreen")))
        .toExist()
        .withTimeout(30000);

      // The browser TV, by its code (the only time she types it).
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
      await visible("remoteOk", 60000);
      await step("cast");

      // Grandma joins from the TV's QR; Dana starts Rocket Crew from the Library.
      await wait("guest-on-couch");
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
      await step("host-in-game");
      await captainRound("");

      // Bedtime: Dana closes the app with the TV still cast (the orchestrator closes the TV page and
      // Grandma's). The next day the cast's launcher token has expired and the TV page shows its
      // code (services/api screen-routes test); here the API's clock is real, so it may still show
      // yesterday's couch until Dana casts.
      await device.terminateApp();
      await step("phone-closed");

      // --- Day 2: the clock a day ahead ------------------------------------------------------------
      await wait("day2-tv-ready");
      taps = 0;
      const t0 = Date.now();
      await device.launchApp({ newInstance: true, launchArgs: { ogsClockOffsetMs: DAY } });
      await waitFor(element(by.id("tabTV")))
        .toBeVisible()
        .withTimeout(60000);
      const opened = Date.now() - t0;
      await tap("tabTV");
      // The TV is remembered: no code to type, and Cast already names it.
      await visible("castButton");
      const target = await element(by.id("castTarget")).getAttributes();
      const targetText = "text" in target && typeof target.text === "string" ? target.text : "";
      await tap("castButton");
      await visible("remoteOk", 60000);
      const cast = Date.now() - t0;
      await step("day2-cast", { target: targetText, openedMs: opened });

      // Grandma rejoins in one tap; then OK on the TV's Play again.
      const { down } = await wait("day2-guest-on-couch");
      const beforeOk = Date.now();
      // The ring is on yesterday's game's card, or one press up from it (a sitting card).
      if (down === true) await tap("remoteDown");
      // OK starts the game on the TV and this phone follows into it: a running game never lets the
      // app go idle, so Detox's synchronization is off from here (captainRound polls).
      await device.disableSynchronization();
      await tap("remoteOk");
      await waitFor(element(by.id("gameScreen")))
        .toExist()
        .withTimeout(60000);
      const inGameMs = Date.now() - beforeOk;
      await step("day2-host-in-game", { castMs: cast, okToGameMs: inGameMs });
      await captainRound("-2");
      await step("day2-taps", { taps });
    },
    WALK_MS,
  );
});
