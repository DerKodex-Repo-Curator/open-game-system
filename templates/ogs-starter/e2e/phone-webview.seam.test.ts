import { chromium, type Page } from "playwright";
import { afterAll, describe, expect, inject, it } from "vitest";
import { gameClaims, signGameToken } from "./keys";

/**
 * The phone page inside a fake OGS app: `window.ReactNativeWebView` answers the page's
 * BRIDGE_READY with the app's stores (a profile with a signed game token, the cast and ogs stores),
 * and records everything the page dispatches.
 */
const BASE = inject("gameUrl");
const privateJwk = inject("privateJwk");
const browserP = chromium.launch();
afterAll(async () => (await browserP).close());

const fakeWebView = (stores: Record<string, unknown>) => `
  window.__ogsSent = [];
  window.ReactNativeWebView = {
    postMessage(raw) {
      const msg = JSON.parse(raw);
      window.__ogsSent.push(msg);
      if (msg.type === "BRIDGE_READY") {
        setTimeout(() => {
          for (const [storeKey, data] of Object.entries(${JSON.stringify(stores)}))
            window.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "STATE_INIT", storeKey, data }) }));
        }, 50);
      }
    },
  };
`;

const CAST = {
  isAvailable: true,
  devices: [],
  session: {
    status: "disconnected",
    deviceId: null,
    deviceName: null,
    sessionId: null,
    streamSessionId: null,
  },
  error: null,
  viewUrl: null,
};

async function inOgsApp(token: string, path = "/"): Promise<Page> {
  const ctx = await (await browserP).newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(
    fakeWebView({
      profile: {
        status: "ready",
        profile: {
          id: "u-sam",
          handle: "sam",
          name: "Sam",
          avatar: "https://example.com/sam.png",
          token,
        },
      },
      cast: CAST,
      ogs: { reported: [] },
    }),
  );
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`);
  return page;
}

const sent = (page: Page) => page.evaluate((): unknown[] => Reflect.get(window, "__ogsSent"));
const viewUrls = async (page: Page) =>
  (await sent(page)).flatMap((m) => {
    if (typeof m !== "object" || m === null || !("event" in m)) return [];
    const ev = m.event;
    return typeof ev === "object" && ev !== null && "url" in ev && typeof ev.url === "string"
      ? [ev.url]
      : [];
  });

async function seats(code: string): Promise<{ id: string; name: string }[]> {
  const body: unknown = await (await fetch(`${BASE}/api/rooms/${code}`)).json();
  if (typeof body !== "object" || body === null || !("seats" in body) || !Array.isArray(body.seats))
    return [];
  return body.seats;
}

async function newRoom(): Promise<string> {
  const body: unknown = await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("code" in body) ||
    typeof body.code !== "string"
  )
    throw new Error("no room");
  return body.code;
}

describe("the phone page in the OGS app", () => {
  it("hosts: makes a room, declares its TV page, and joins under the verified OGS name with no form", async () => {
    const page = await inOgsApp(await signGameToken(privateJwk, gameClaims()));
    await expect.poll(() => viewUrls(page)).toHaveLength(1);
    const [url] = await viewUrls(page);
    const code = new URL(url ?? "").searchParams.get("room") ?? "";
    expect(url).toBe(`${BASE}/tv?room=${code}`);
    await expect.poll(() => page.locator("#me-name").textContent()).toBe("Sam");
    expect(await page.locator("#join-form").isVisible()).toBe(false);
    await expect
      .poll(() => seats(code))
      .toEqual([expect.objectContaining({ id: "ogs:u-sam", name: "Sam" })]);
    await page.context().close();
  });

  it("follows the TV into its room when OGS opens it with ogsRoom, and declares no TV page", async () => {
    const code = await newRoom();
    const page = await inOgsApp(
      await signGameToken(privateJwk, gameClaims({ sub: "u-ada", name: "Ada" })),
      `/?ogsRoom=${code}`,
    );
    await expect
      .poll(() => seats(code))
      .toEqual([expect.objectContaining({ id: "ogs:u-ada", name: "Ada" })]);
    expect(await viewUrls(page)).toEqual([]);
    await page.context().close();
  });

  it("never seats a token signed for another game, or an expired one", async () => {
    for (const claims of [
      gameClaims({ aud: "other-game" }),
      gameClaims({ exp: Math.floor(Date.now() / 1000) - 10 }),
    ]) {
      const code = await newRoom();
      const page = await inOgsApp(await signGameToken(privateJwk, claims), `/?ogsRoom=${code}`);
      await expect.poll(() => page.locator("#status").textContent()).toContain("Couldn't join");
      expect(await seats(code)).toEqual([]);
      await page.context().close();
    }
  });
});

describe("the phone page in a plain browser", () => {
  it("keeps its own name form and joins under the typed name", async () => {
    const code = await newRoom();
    const page = await (await browserP).newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${BASE}/?room=${code}`);
    await page.getByLabel("Your name").fill("Bo");
    await page.getByRole("button", { name: "Join" }).click();
    await expect.poll(() => seats(code)).toEqual([expect.objectContaining({ name: "Bo" })]);
    expect(await page.locator("#join-form").isVisible()).toBe(false);
    await page.close();
  });
});
