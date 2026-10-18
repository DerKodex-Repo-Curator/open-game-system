import jsQR from "jsqr";
import type { Browser, Page } from "playwright";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch, open, shot } from "./harness";

// Acceptance: 2026-10-06-join-and-invite.feature, "Home shows the QR next to the TV code" and
// "Getting ready shows the same card". A stranger's guest sees the TV, not the app: the card says
// where to go, and the QR takes a phone camera there.

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser.close();
});

/** What a phone camera reads off the TV: the card's QR, decoded from a screenshot. */
async function scanQr(page: Page): Promise<string | null> {
  const png = PNG.sync.read(await page.getByTestId("join-qr").screenshot());
  return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data ?? null;
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function box(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  return b;
}

describe("the join card", () => {
  it("on Home: a QR to opengame.org/join/<code>, 'Scan to join, or type', the code and the address", async () => {
    const page = await open(browser);
    await page.getByTestId("home").waitFor();
    const card = page.getByTestId("join-code");
    expect(await card.getByTestId("join-line").textContent()).toBe("Scan to join, or type");
    expect(await card.getByTestId("join-value").textContent()).toBe("KQ7M2X");
    expect(await card.getByTestId("join-where").textContent()).toBe("at opengame.org/join");
    expect(await scanQr(page)).toBe("https://opengame.org/join/KQ7M2X");
    await shot(page, "join-01-home");
  });

  it("sits bottom-right and covers neither the focus row nor the couch", async () => {
    const page = await open(browser);
    await page.getByTestId("home").waitFor();
    const card = await box(page, "[data-testid=join-code]");
    expect(card.x + card.width).toBeGreaterThan(1920 / 2);
    expect(card.y + card.height).toBeGreaterThan(1080 / 2);
    expect(overlaps(card, await box(page, '[data-row="games"]'))).toBe(false);
    expect(overlaps(card, await box(page, "[data-testid=couch]"))).toBe(false);
    expect(card.x + card.width).toBeLessThanOrEqual(1824 + 1);
    expect(card.y + card.height).toBeLessThanOrEqual(1026 + 1);
  });

  it("while Getting ready shows the same QR and code", async () => {
    const page = await open(browser, "?fake=1&hold=1");
    await page.getByTestId("assembling").waitFor();
    expect(await page.getByTestId("join-value").textContent()).toBe("KQ7M2X");
    expect(await scanQr(page)).toBe("https://opengame.org/join/KQ7M2X");
  });
});
