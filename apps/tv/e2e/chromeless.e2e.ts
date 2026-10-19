import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch, open, ROCKET_TV, receivedBy, send } from "./harness";

/**
 * chrome=none (docs/acceptance/2026-10-18-cast-chrome-none.feature): a white-label app casts its game
 * with no OGS launcher around it, in a real browser on the fake couch session.
 */
let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser.close();
});

const testIds = (page: Page) => page.evaluate(() => [...document.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid")));

describe("a white-label app's cast", () => {
  it("shows the manifest's tvUrl full screen, with no launcher chrome", async () => {
    const page = await open(browser, "?fake=1&chrome=none&app=rocket-crew");
    await page.getByTestId("chromeless").waitFor();
    await expect.poll(() => page.getByTestId("tv-url-frame").getAttribute("src")).toBe("https://rocket-crew.jonathanrmumm.workers.dev/tv");
    const box = await page.getByTestId("tv-url-frame").boundingBox();
    expect(box).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(await page.locator(".launcher").count()).toBe(0);
    expect(await testIds(page)).toEqual(["chromeless", "tv-url-frame"]);
    await page.context().close();
  });

  it("frames the game's TV page once the phone declares it, and the game gets ogs:start", async () => {
    const page = await open(browser, "?fake=1&chrome=none&app=rocket-crew");
    await page.getByTestId("chromeless").waitFor();
    await send(page, { type: "focus.set", itemId: "game:rocket-crew" });
    await send(page, { type: "select", deviceId: "jonathan-phone" });
    await send(page, { type: "select", deviceId: "jonathan-phone" });
    await send(page, { type: "game.view", appId: "rocket-crew", url: ROCKET_TV });
    await expect.poll(() => page.getByTestId("game-frame").getAttribute("src")).toBe(ROCKET_TV);
    await expect.poll(() => receivedBy(page, "game-frame")).toEqual(["ogs:start"]);
    expect(await page.locator(".launcher, [data-testid=starting], [data-testid=game-page]").count()).toBe(0);
    await page.context().close();
  });

  it("without chrome=none the launcher is as it was", async () => {
    const page = await open(browser, "?fake=1");
    await page.locator(".launcher").waitFor();
    expect(await page.getByTestId("chromeless").count()).toBe(0);
    await page.context().close();
  });
});
