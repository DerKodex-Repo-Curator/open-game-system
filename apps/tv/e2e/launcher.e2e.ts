import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { visibleRect } from "../src/launcher/cutover";
import {
  attr,
  BAKE_TV,
  BROKEN_TV,
  count,
  launch,
  open,
  ROCKET_TV,
  receivedBy,
  SHOTS,
  send,
  sessionState,
  settle,
  shot,
  textRuns,
} from "./harness";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser.close();
});

const bootId = () => page.evaluate(() => window.__launcherBootId);
const focused = () =>
  page.evaluate(() => document.querySelector("[data-focused]")?.getAttribute("data-item") ?? null);

async function expectTvRules() {
  const runs = await textRuns(page);
  expect(runs.length).toBeGreaterThan(0);
  const small = runs.filter((t) => t.size < 24);
  expect(small, `text under 24 px: ${JSON.stringify(small)}`).toEqual([]);
  const unsafe = runs.filter(
    (t) => t.x < 96 - 1 || t.r > 1824 + 1 || t.y < 54 - 1 || t.b > 1026 + 1,
  );
  expect(unsafe, `text outside title-safe: ${JSON.stringify(unsafe)}`).toEqual([]);
}

describe("TV launcher (fake session)", () => {
  beforeEach(async () => {
    page = await open(browser);
    await page.getByTestId("home").waitFor();
  });

  it("renders home: icon row, the focused game's room, activity cards, the couch and the remote", async () => {
    await expect.poll(focused).toBe("game:bake-shop");
    const icons = await page
      .locator('[data-row="games"] [data-item]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-item")));
    expect(icons).toEqual([
      "game:bake-shop",
      "game:story-nook",
      "game:hearthisle",
      "game:rocket-crew",
      "game:peekaboo-garden",
      "game:night-flight",
    ]);
    const cards = await page
      .locator('[data-row="activity"] [data-item]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-item")));
    expect(cards).toHaveLength(3);
    // Cards start a game at once: the latest sitting, Surprise me (this visit's pick), the next sitting.
    expect(cards[0]).toMatch(/^play:bake-shop:/);
    expect(cards[1]).toMatch(/^play:(story-nook|rocket-crew|peekaboo-garden|night-flight)$/);
    expect(cards[2]).toBe("play:story-nook:story-nook-ember");
    // Each fact once (owner, 2026-10-04): Bake Shop is focused, so the spotlight says "Day 4" and
    // its card doesn't; the other sitting's card keeps its own name.
    expect(
      await page.locator('[data-card="sitting"][data-app="bake-shop"]').textContent(),
    ).not.toContain("Day 4");
    expect(
      await page.locator('[data-card="sitting"][data-app="story-nook"]').textContent(),
    ).toContain("Juneau's dragon is ready");
    expect(await page.getByText("Day 4").count()).toBe(1);
    // The focused icon shows its name; the room shows its clean art and logo, with the resume point.
    expect(await page.locator("[data-focused] .game-icon-name").textContent()).toBe("Bake Shop");
    expect(await page.locator(".room-art.in").getAttribute("src")).toBe(
      "/art/bake-shop/hero-clean.jpg",
    );
    expect(await page.locator(".spot-logo").getAttribute("src")).toBe("/art/bake-shop/logo.png");
    expect(await page.locator(".spot-resume").textContent()).toBe("Day 4");
    expect(await page.locator(".spot-tag").textContent()).toMatch(/^Paused /);
    expect(await page.locator(".room-name").textContent()).toBe(
      "Living room TV · Jonathan's games",
    );
    // The couch is whoever joined this cast, in join order: nobody joins automatically.
    const sitters = await page.locator("[data-testid=couch] figcaption").allTextContents();
    expect(sitters).toEqual(["Jonathan", "Mom", "Juneau"]);
    // Copy from the join spec (2026-10-06-join-and-invite.feature): the QR card, e2e/join-qr.e2e.ts.
    expect(await page.getByTestId("join-code").textContent()).toBe(
      "Scan to join, or typeKQ7M2Xat opengame.org/join",
    );
    expect(await page.getByTestId("remote-chip").textContent()).toContain(
      "Jonathan has the remote",
    );
    expect(await page.getByTestId("hero").getAttribute("data-hero")).toBe("bake-shop");
    await shot(page, "01-home");
    await expectTvRules();
  });

  it("opens a paused game's page on select: Continue at its resume point, Start game, who's here", async () => {
    await expect.poll(focused).toBe("game:bake-shop");
    await send(page, { type: "select", deviceId: "jonathan-phone" });
    await page.getByTestId("game-page").waitFor();
    expect(await page.getByTestId("action-continue").textContent()).toBe("Continue Day 4");
    expect(await page.getByTestId("action-start").textContent()).toBe("Start game");
    expect(await page.getByTestId("action-continue").getAttribute("class")).toContain("focused");
    const here = await page.locator(".page-sticker figcaption").allTextContents();
    expect(here).toEqual(["Jonathan", "Mom", "Juneau"]);
    await shot(page, "03b-game-page-paused");
    await expectTvRules();
    // The remote moves between Continue and Start game.
    await send(page, { type: "focus.move", dir: "right" });
    await expect.poll(() => attr(page, "action-start", "class")).toContain("focused");
    expect(await page.getByTestId("action-continue").getAttribute("class")).not.toContain(
      "focused",
    );
    await send(page, { type: "back" });
    await page.getByTestId("game-page").waitFor({ state: "detached" });
    // Back home, the ring returns to the game whose page was open.
    await expect.poll(focused).toBe("game:bake-shop");
  });

  // Owner, 2026-10-04: "Paused" was said three times for one paused game. Counted on what is on
  // screen, on each screen a paused game shows: rendered text whose middle is not covered (the
  // game page is opaque over Home, whose spotlight stays mounted under it).
  it('says "Paused" once: icon focused, its card focused, and on its page', async () => {
    const pausedOnScreen = () =>
      page.evaluate(() => {
        const sayers = [...document.querySelectorAll<HTMLElement>("body *")].filter((e) =>
          [...e.childNodes].some((n) => n.nodeType === 3 && /Paused/.test(n.textContent ?? "")),
        );
        return sayers.filter((e) => {
          const r = e.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || !e.checkVisibility({ opacityProperty: true }))
            return false;
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return hit !== null && (e === hit || e.contains(hit) || hit.contains(e));
        }).length;
      });
    await expect.poll(focused).toBe("game:bake-shop");
    expect(await pausedOnScreen()).toBe(1);
    await send(page, { type: "focus.move", dir: "down" });
    await expect.poll(focused).toMatch(/^play:bake-shop:/);
    expect(await pausedOnScreen()).toBe(1);
    await send(page, { type: "focus.move", dir: "up" });
    await expect.poll(focused).toBe("game:bake-shop");
    await send(page, { type: "select", deviceId: "jonathan-phone" });
    await page.getByTestId("game-page").waitFor();
    await settle(page);
    expect(await pausedOnScreen()).toBe(1);
  });

  it("starts a fresh sitting from Start game on a paused game's page", async () => {
    await expect.poll(focused).toBe("game:bake-shop");
    await send(page, { type: "select", deviceId: "jonathan-phone" });
    await page.getByTestId("game-page").waitFor();
    await send(page, { type: "focus.move", dir: "right" });
    await expect.poll(() => attr(page, "action-start", "class")).toContain("focused");
    await send(page, { type: "select", deviceId: "jonathan-phone" });
    await expect.poll(async () => (await sessionState(page))?.current?.mode).toBe("new");
    expect((await sessionState(page))?.current?.label).toBe("");
  });

  it("continues a sitting straight from its card", async () => {
    await expect.poll(focused).toBe("game:bake-shop");
    await send(page, { type: "focus.move", dir: "down" });
    await expect.poll(focused).toMatch(/^play:bake-shop:/);
    expect(await page.getByTestId("hero").getAttribute("data-hero")).toBe("bake-shop");
    await shot(page, "01b-home-card-focus");
    await expectTvRules();
    await send(page, { type: "select", deviceId: "jonathan-phone" });
    await page.getByTestId("starting").waitFor();
    const s = await sessionState(page);
    expect([s?.screen, s?.current?.appId, s?.current?.mode, s?.current?.label]).toEqual([
      "game",
      "bake-shop",
      "continue",
      "Day 4",
    ]);
    expect(s?.current?.hostDeviceId).toBe("jonathan-phone");
    expect(await count(page, "[data-testid=game-page]")).toBe(0);
  });

  it("Surprise me spins the icons, lands on a game and starts it", async () => {
    const item = await page.locator('[data-card="surprise"]').getAttribute("data-item");
    const pick = item?.replace(/^play:/, "") ?? "";
    expect(pick).toMatch(/^[a-z-]+$/);
    await send(page, { type: "focus.set", itemId: `play:${pick}` });
    await expect.poll(focused).toBe(`play:${pick}`);
    expect(await page.getByTestId("hero").getAttribute("data-hero")).toBe("surprise");
    await send(page, { type: "select", deviceId: "jonathan-phone" });
    // The select itself starts the pick on the selecting phone; the reel plays over Getting ready.
    await page.getByTestId("surprise").waitFor();
    expect(await page.getByTestId("surprise").getAttribute("data-pick")).toBe(pick);
    const started = await sessionState(page);
    expect([started?.screen, started?.current?.appId, started?.current?.hostDeviceId]).toEqual([
      "game",
      pick,
      "jonathan-phone",
    ]);
    expect(started?.page).toBeNull();
    // Not the game just played (Bake Shop is the last paused one), and never a grown-up game.
    expect(pick).not.toBe("bake-shop");
    expect(pick).not.toBe("hearthisle");
    await page.locator('[data-testid=surprise][data-phase="landed"]').waitFor();
    await shot(page, "07-surprise");
    // Then the reel gives way to the game.
    await page.getByTestId("surprise").waitFor({ state: "detached", timeout: 4000 });
  });

  it("shows who played last time on a game's page, by profile", async () => {
    await send(page, {
      type: "game.start",
      appId: "rocket-crew",
      mode: "new",
      roster: [{ profileId: "juneau", roleId: "fixer" }],
    });
    await send(page, { type: "home" });
    await send(page, { type: "focus.set", itemId: "game:rocket-crew" });
    await expect.poll(focused).toBe("game:rocket-crew");
    // Home's spotlight shows who played it last time, by sticker.
    expect(await page.locator("[data-testid=spot-players] img").count()).toBe(1);
    await send(page, { type: "select", deviceId: "jonathan-phone" });
    await page.getByTestId("game-page").waitFor();
    expect(await page.locator(".page-players .eyebrow").textContent()).toBe("Playing last time");
    expect(await page.locator(".page-sticker figcaption").allTextContents()).toEqual(["Juneau"]);
  });

  it("moves the ring on focus.move, through the session", async () => {
    await expect.poll(focused).toBe("game:bake-shop");
    await send(page, { type: "focus.move", dir: "right" });
    await expect.poll(focused).toBe("game:story-nook");
    expect((await sessionState(page))?.focus).toBe("game:story-nook");
    // Down goes to the first card (the latest sitting); up comes back to the icon it left.
    await send(page, { type: "focus.move", dir: "down" });
    await expect.poll(focused).toMatch(/^play:bake-shop:/);
    await send(page, { type: "focus.move", dir: "right" });
    await expect.poll(focused).toMatch(/^play:[a-z-]+$/);
    await send(page, { type: "focus.move", dir: "up" });
    await expect.poll(focused).toBe("game:story-nook");
    await send(page, { type: "focus.move", dir: "right" });
    await send(page, { type: "focus.move", dir: "right" });
    await expect.poll(focused).toBe("game:rocket-crew");
    expect(await page.getByTestId("hero").getAttribute("data-hero")).toBe("rocket-crew");
    await shot(page, "02-focus-library");
    await expectTvRules();
  });

  it("starts a game from the remote, frames its view, then Home puts it back in its box", async () => {
    const boot = await bootId();
    await send(page, { type: "focus.set", itemId: "game:rocket-crew" });
    await expect.poll(focused).toBe("game:rocket-crew");

    await send(page, { type: "select", deviceId: "jonathan-phone" });
    await page.getByTestId("game-page").waitFor();
    await shot(page, "03-game-page");
    await expectTvRules();

    await send(page, { type: "select", deviceId: "jonathan-phone" });
    await page.getByTestId("starting").waitFor();
    expect(await page.getByTestId("starting").textContent()).toContain(
      "Starting Rocket Crew on Jonathan's phone",
    );
    expect((await sessionState(page))?.screen).toBe("game");
    await shot(page, "04-starting");
    await expectTvRules();

    await send(page, { type: "game.view", appId: "rocket-crew", url: ROCKET_TV });
    await expect.poll(() => attr(page, "game-frame", "src")).toBe(ROCKET_TV);
    await expect.poll(() => attr(page, "game-frame", "class")).toContain("live");
    // The framed game got ogs:start and answered with its resume point, forwarded to the session.
    await expect.poll(async () => (await sessionState(page))?.current?.label).toBe("Mission 6");
    const received = await receivedBy(page, "game-frame");
    expect(received).toEqual(["ogs:start"]);
    await shot(page, "05-game-framed");

    await send(page, { type: "home" });
    await page.locator('[data-testid=player][data-phase="hidden"]').waitFor({ state: "attached" });
    const card = page.locator('[data-card="sitting"][data-app="rocket-crew"]');
    await expect.poll(focused).toBe("game:rocket-crew");
    // Rocket Crew is focused: the spotlight says "Mission 6", its card doesn't repeat it.
    expect(await page.locator(".spot-resume").textContent()).toBe("Mission 6");
    expect(await card.textContent()).not.toContain("Mission 6");
    // Each fact once (owner, 2026-10-04): the focused game's status is said by the spotlight only,
    // not again on its card.
    expect(await page.locator(".spot-tag").textContent()).toBe("Paused just now");
    expect(await card.textContent()).not.toContain("Paused");
    expect(await page.getByText("Paused just now").count()).toBe(1);
    // The parked frame was told to suspend and stays loaded for an instant Continue.
    const afterHome = await receivedBy(page, "parked-frame");
    expect(afterHome).toEqual(["ogs:start", "ogs:suspend"]);
    await shot(page, "06-home-continue");
    await expectTvRules();

    expect(await bootId()).toBe(boot);
  });

  it("swaps games and resumes the parked one without reloading the launcher", async () => {
    const boot = await bootId();
    await send(page, { type: "game.start", appId: "rocket-crew", mode: "new" });
    await send(page, { type: "game.view", appId: "rocket-crew", url: ROCKET_TV });
    await expect.poll(() => attr(page, "game-frame", "class")).toContain("live");

    await send(page, { type: "game.start", appId: "bake-shop", mode: "continue" });
    await send(page, { type: "game.view", appId: "bake-shop", url: BAKE_TV });
    await expect.poll(() => attr(page, "game-frame", "src")).toBe(BAKE_TV);
    await expect.poll(() => attr(page, "game-frame", "class")).toContain("live");
    expect((await sessionState(page))?.casts).toBe(1);

    // Bake Shop says nothing back: Home still works, with the session's own label.
    await send(page, { type: "home" });
    await page.locator('[data-testid=player][data-phase="hidden"]').waitFor({ state: "attached" });
    const sittings = await page
      .locator('[data-card="sitting"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-app")));
    expect(sittings.slice(0, 2)).toEqual(["bake-shop", "rocket-crew"]);
    // Each fact once (owner, 2026-10-04): Bake Shop's "Day 4" is said once, by the spotlight when
    // Bake Shop is focused, else by its card; Rocket Crew's card keeps its own name.
    expect(await page.getByText("Day 4").count()).toBe(1);
    expect(
      await page.locator('[data-card="sitting"][data-app="rocket-crew"] .card-resume').count(),
    ).toBe(1);

    await send(page, { type: "game.start", appId: "bake-shop", mode: "continue" });
    await expect.poll(() => attr(page, "game-frame", "src")).toBe(BAKE_TV);
    expect(await count(page, "[data-testid=starting]")).toBe(0);
    expect(await bootId()).toBe(boot);
    expect((await sessionState(page))?.casts).toBe(1);
  });

  it("shows a calm card when a game's frame never loads", async () => {
    page = await open(browser, "?fake=1&frameTimeout=1200");
    await page.getByTestId("home").waitFor();
    await send(page, { type: "game.start", appId: "night-flight", mode: "new" });
    await send(page, { type: "game.view", appId: "night-flight", url: BROKEN_TV });
    await page.getByTestId("frame-failed").waitFor({ timeout: 5000 });
    expect(await page.getByTestId("frame-failed").textContent()).toContain(
      "Choose another on Jonathan's phone",
    );
    await shot(page, "08-frame-failed");
    await expectTvRules();
  });

  it("says a game didn't open when it never sends its TV page, and Home comes back", async () => {
    page = await open(browser, "?fake=1&viewTimeout=1500");
    await page.getByTestId("home").waitFor();
    // Started on the phone, but its phone page never asks for its TV view (no game.view).
    await send(page, { type: "game.start", appId: "bake-shop", mode: "new" });
    await page.getByTestId("starting").waitFor();
    expect(await count(page, "[data-testid=no-view]")).toBe(0);
    await page.getByTestId("no-view").waitFor({ timeout: 5000 });
    expect(await count(page, "[data-testid=starting]")).toBe(0);
    const card = await page.getByTestId("no-view").textContent();
    expect(card).toContain("Couldn't open");
    expect(card).toContain("Bake Shop didn't open on the TV");
    expect(card).toContain("Press Home on Jonathan's phone to come back");
    await shot(page, "08b-no-view");
    await expectTvRules();
    // The card stays in the lower left, clear of the focal area in the middle of the screen.
    const box = await page.getByTestId("no-view").boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThan(1920 * 0.62);
    expect(box?.y ?? 0).toBeGreaterThan(1080 * 0.4);
    // The remote's Home goes back to the launcher home, the sitting paused.
    await send(page, { type: "home" });
    await page.locator('[data-testid=player][data-phase="hidden"]').waitFor({ state: "attached" });
    expect(await count(page, "[data-testid=no-view]")).toBe(0);
    expect((await sessionState(page))?.screen).toBe("home");
  });

  it("frames the game if its TV page arrives after the wait, and a Continue waits afresh", async () => {
    page = await open(browser, "?fake=1&viewTimeout=1200");
    await page.getByTestId("home").waitFor();
    await send(page, { type: "game.start", appId: "rocket-crew", mode: "new" });
    await page.getByTestId("no-view").waitFor({ timeout: 5000 });
    await send(page, { type: "game.view", appId: "rocket-crew", url: ROCKET_TV });
    await expect.poll(() => attr(page, "game-frame", "class")).toContain("live");
    expect(await count(page, "[data-testid=no-view]")).toBe(0);
    // Home, then start Bake Shop's paused sitting: Getting ready again, not straight to didn't open.
    await send(page, { type: "home" });
    await send(page, { type: "game.start", appId: "bake-shop", mode: "continue" });
    await page.getByTestId("starting").waitFor();
    expect(await count(page, "[data-testid=no-view]")).toBe(0);
  });

  it("names the TV the cast moved to in the header (Change TV on the phone)", async () => {
    expect(await page.locator(".room-name").textContent()).toBe(
      "Living room TV · Jonathan's games",
    );
    await send(page, { type: "tv.rename", name: "Bedroom TV" });
    await expect
      .poll(() => page.locator(".room-name").textContent())
      .toBe("Bedroom TV · Jonathan's games");
  });

  it("keeps the last state with a reconnecting chip when the socket drops", async () => {
    await expect.poll(focused).toBe("game:bake-shop");
    await page.evaluate(() => window.__ogsFake?.drop());
    await page.getByTestId("reconnecting").waitFor();
    expect(await page.getByTestId("home").isVisible()).toBe(true);
    expect(await focused()).toBe("game:bake-shop");
    await shot(page, "09-reconnecting");
    await expectTvRules();
    await page.evaluate(() => window.__ogsFake?.restore());
    await expect.poll(() => count(page, "[data-testid=reconnecting]")).toBe(0);
  });
});

describe("the cut-over", () => {
  it("grows the focused icon to full screen and shrinks it back into its icon", async () => {
    page = await open(browser);
    await page.getByTestId("home").waitFor();
    await send(page, { type: "focus.set", itemId: "game:rocket-crew" });
    await expect.poll(focused).toBe("game:rocket-crew");
    await settle(page, 500);
    const box = await page.locator('[data-cover="rocket-crew"]').boundingBox();

    await send(page, { type: "game.start", appId: "rocket-crew", mode: "new" });
    const grow = await firstFrame(page);
    expect(grow.duration).toBeLessThanOrEqual(700);
    // It starts exactly on the square icon (the art scaled to cover it and clipped to it).
    expect(grow.x).toBeCloseTo(box?.x ?? -1, 0);
    expect(grow.y).toBeCloseTo(box?.y ?? -1, 0);
    expect(grow.w).toBeCloseTo(box?.width ?? -1, 0);
    expect(grow.h).toBeCloseTo(box?.height ?? -1, 0);
    await midMotion(page, "04a-cutover-grow");

    await send(page, { type: "game.view", appId: "rocket-crew", url: ROCKET_TV });
    await expect.poll(() => attr(page, "game-frame", "class")).toContain("live");
    await send(page, { type: "home" });
    await page.locator('[data-card="sitting"][data-app="rocket-crew"]').waitFor();
    const target = await page.locator('[data-cover="rocket-crew"]').boundingBox();
    const shrink = await lastSmallFrame(page);
    expect(shrink.x).toBeCloseTo(target?.x ?? -1, 0);
    expect(shrink.y).toBeCloseTo(target?.y ?? -1, 0);
    expect(shrink.w).toBeCloseTo(target?.width ?? -1, 0);
    // It lands on the focused icon at the head of the row, where it rests (not mid-grow).
    expect(shrink.x).toBeCloseTo(96, 0);
    await midMotion(page, "06a-cutover-shrink");
  });
});

/** The player animation's keyframe at the box, as the stage rect it shows, read from the running animation. */
async function boxKeyframe(p: Page, which: "first" | "smallest") {
  const k = await p.getByTestId("player").evaluate((el, w) => {
    const a = el.getAnimations()[0];
    const effect = a?.effect;
    if (!a || !(effect instanceof KeyframeEffect)) throw new Error("no cut-over animation");
    const frames = effect
      .getKeyframes()
      .map((f) => ({ transform: String(f.transform), clipPath: String(f.clipPath) }));
    const small = w === "first" ? frames[0] : frames.find((f) => !f.transform.includes("scale(1)"));
    return { frame: small, duration: Number(effect.getTiming().duration) };
  }, which);
  if (!k.frame) throw new Error("no small keyframe");
  return { ...visibleRect(k.frame), duration: k.duration };
}
const firstFrame = (p: Page) => boxKeyframe(p, "first");
const lastSmallFrame = (p: Page) => boxKeyframe(p, "smallest");

/** Freeze the cut-over halfway and keep a picture of it. */
async function midMotion(p: Page, name: string) {
  await p.getByTestId("player").evaluate((el) => {
    for (const a of el.getAnimations()) {
      a.pause();
      a.currentTime = 300;
    }
  });
  await p.screenshot({ path: `${SHOTS}${name}.png` });
  await p.getByTestId("player").evaluate((el) => {
    for (const a of el.getAnimations()) a.play();
  });
}

describe("TV launcher before the session", () => {
  it("assembles the living room while connecting, not a black card", async () => {
    page = await open(browser, "?fake=1&hold=1");
    await page.getByTestId("assembling").waitFor();
    expect(await page.getByTestId("assembling").textContent()).toContain(
      "Setting up the living room",
    );
    // Before the session state arrives: the title from the session fetch and the host only.
    await expect
      .poll(() => page.locator(".room-name").textContent())
      .toBe("Living room TV · Jonathan's games");
    expect(await page.locator("[data-testid=couch] figcaption").allTextContents()).toEqual([
      "Jonathan",
    ]);
    expect(await page.getByTestId("join-code").textContent()).toContain("KQ7M2X");
    await shot(page, "00-connecting");
    await expectTvRules();
    await page.evaluate(() => window.__ogsFake?.connect());
    await page.getByTestId("home").waitFor();
  });

  it("honours reduced motion: the cut-over is a short fade", async () => {
    page = await open(browser, "?fake=1", { reducedMotion: true });
    await page.getByTestId("home").waitFor();
    await send(page, { type: "game.start", appId: "rocket-crew", mode: "new" });
    const anim = await page
      .getByTestId("player")
      .evaluate((el) => el.getAnimations().map((a) => Number(a.effect?.getTiming().duration ?? 0)));
    expect(Math.max(...anim)).toBeLessThanOrEqual(200);
  });

  it("explains itself when opened without a launcher link", async () => {
    page = await open(browser, "?");
    await page.getByText("This TV page needs its link from the OGS app").waitFor();
  });
});
