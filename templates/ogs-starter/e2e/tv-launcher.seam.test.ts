import { chromium, type Frame, type Page } from "playwright";
import { afterAll, describe, expect, inject, it } from "vitest";

/**
 * The TV page framed by a stand-in for the OGS TV launcher: one iframe, the launcher's messages
 * posted into it, and everything the page posts back recorded.
 */
const BASE = inject("gameUrl");
const browserP = chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
afterAll(async () => (await browserP).close());

const TRACK_AUDIO = `
  window.__ctxs = [];
  const Real = window.AudioContext;
  window.AudioContext = class extends Real {
    constructor(...a) { super(...a); window.__ctxs.push(this); }
  };
`;

async function newRoom(): Promise<string> {
  const res = await fetch(`${BASE}/api/rooms`, { method: "POST" });
  const body: unknown = await res.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("code" in body) ||
    typeof body.code !== "string"
  )
    throw new Error("no room");
  return body.code;
}

async function launcher(code: string): Promise<{
  page: Page;
  frame: Frame;
  got: () => Promise<unknown[]>;
  post: (m: object) => Promise<void>;
}> {
  const page = await (await browserP).newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(TRACK_AUDIO);
  await page.setContent(`<script>window.__got=[];addEventListener("message",e=>window.__got.push(e.data))</script>
    <iframe id="game" allow="autoplay; fullscreen" src="${BASE}/tv?room=${code}" style="width:1280px;height:720px;border:0"></iframe>`);
  const frame = await (await page.waitForSelector("#game")).contentFrame();
  if (!frame) throw new Error("no game frame");
  return {
    page,
    frame,
    got: () => page.evaluate(() => Reflect.get(window, "__got")),
    post: (msg) =>
      page.evaluate((m) => {
        const el = document.getElementById("game");
        if (el instanceof HTMLIFrameElement) el.contentWindow?.postMessage(m, "*");
      }, msg),
  };
}

const START = {
  type: "ogs:start",
  instanceId: "i1",
  mode: "new",
  roster: [],
  token: "",
  players: [{ id: "p1", handle: "sam", name: "Sam", avatar: "https://example.com/a.png" }],
};

describe("the TV page on the OGS TV", () => {
  it("says ogs:ready, then on ogs:start hides its own code and QR and names the couch", async () => {
    const code = await newRoom();
    const { page, frame, got, post } = await launcher(code);
    await expect.poll(got).toContainEqual({ type: "ogs:ready" });
    await post(START);
    await expect.poll(() => frame.locator("#join").isHidden()).toBe(true);
    await expect.poll(() => frame.locator("#waiting").textContent()).toContain("Sam");
    await page.close();
  });

  it("reports its room (so the couch's phones follow) and the sitting's label", async () => {
    const code = await newRoom();
    const { page, got, post } = await launcher(code);
    await expect.poll(got).toContainEqual({ type: "ogs:ready" });
    await post(START);
    await expect.poll(got).toContainEqual({ type: "ogs:room", room: code });
    await expect.poll(got).toContainEqual(
      expect.objectContaining({
        type: "ogs:instance",
        report: expect.objectContaining({
          title: "Round 1",
          appId: "ogs-starter",
          instanceId: "i1",
        }),
      }),
    );
    await page.close();
  });

  it("goes silent on ogs:suspend and comes back on ogs:resume", async () => {
    const code = await newRoom();
    const { page, frame, post } = await launcher(code);
    const states = () =>
      frame.evaluate(() => Reflect.get(window, "__ctxs").map((c: AudioContext) => c.state));
    await expect.poll(states, { timeout: 15_000 }).toEqual(["running"]);
    await post({ type: "ogs:suspend" });
    await expect.poll(states).toEqual(["suspended"]);
    await page.waitForTimeout(500);
    expect(await states()).toEqual(["suspended"]);
    await post({ type: "ogs:resume" });
    await expect.poll(states).toEqual(["running"]);
    await page.close();
  });
});

describe("the TV page in a plain browser", () => {
  it("makes its own room and shows the code and QR", async () => {
    const page = await (await browserP).newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${BASE}/tv`);
    await expect.poll(() => page.locator("#join-code").textContent()).toMatch(/^[A-Z]{4}$/);
    expect(await page.locator("#join").isVisible()).toBe(true);
    expect(new URL(page.url()).searchParams.get("room")).toMatch(/^[A-Z]{4}$/);
    await page.close();
  });
});
