# Testing your game

You do not need the OGS app, a Chromecast or the real launcher to test an OGS integration. Test at
the seams instead: **frame your TV page from a tiny parent page that plays the launcher**, and **load
your phone page with a fake WebView bridge**. Both run in Playwright under Vitest (or any test runner)
against your local dev server.

Write each test before the code it covers, and see it fail first.

## Setup

```bash
pnpm add -D vitest playwright
pnpm exec playwright install chromium
```

Start your game locally (for example `wrangler dev`) and point the tests at it with an environment
variable (`GAME_URL`). Pick free ports (listen on port 0) for the game and the test key set rather than
fixed ones: another dev server on the same port would answer in their place. The starter's
`e2e/global-setup.ts` does this. Autoplay needs `--autoplay-policy=no-user-gesture-required`,
because the launcher plays without a tap.

## 1. The TV page in a stand-in launcher

The parent page is one iframe, like the launcher's. The test posts the launcher's messages into the
iframe and asserts on the page. This one proves the TV goes silent when parked: it records every
`AudioContext` the page creates, then checks their state after `ogs:suspend` and `ogs:resume`.

```ts
// e2e/ogs-pause.seam.test.ts
import { chromium, type Frame } from "playwright";
import { afterAll, describe, expect, it } from "vitest";

const BASE = process.env.GAME_URL ?? "http://localhost:8787";
const TV_URL = `${BASE}/tv`; // your TV page
const browserP = chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
afterAll(async () => (await browserP).close());

/** Remember every AudioContext the page makes, so the test can read its state. */
const TRACK_AUDIO = `
  window.__ctxs = [];
  const Real = window.AudioContext;
  window.AudioContext = class extends Real {
    constructor(...a) { super(...a); window.__ctxs.push(this); }
  };
`;
const states = (f: Frame) =>
  f.evaluate(() => Reflect.get(window, "__ctxs").map((c: AudioContext) => c.state));

describe("parked by the OGS launcher", () => {
  it("suspends the TV's sound on ogs:suspend and resumes it on ogs:resume", async () => {
    const page = await (await browserP).newPage();
    await page.addInitScript(TRACK_AUDIO); // runs in the iframe too
    await page.setContent(
      `<iframe id="game" allow="autoplay; fullscreen" src="${TV_URL}" style="width:1280px;height:720px;border:0"></iframe>`,
    );
    const frame = await (await page.waitForSelector("#game")).contentFrame();
    if (!frame) throw new Error("no game frame");
    await expect.poll(() => states(frame), { timeout: 15_000 }).toEqual(["running"]);

    const post = (msg: object) =>
      page.evaluate((m) => {
        const el = document.getElementById("game");
        if (el instanceof HTMLIFrameElement) el.contentWindow?.postMessage(m, "*");
      }, msg);

    await post({ type: "ogs:suspend" });
    await expect.poll(() => states(frame)).toEqual(["suspended"]);
    await page.waitForTimeout(500);
    expect(await states(frame)).toEqual(["suspended"]); // nothing (a music loop) wakes it

    await post({ type: "ogs:resume" });
    await expect.poll(() => states(frame)).toEqual(["running"]);
    await page.close();
  }, 30_000);
});
```

Add the same shape for the rest of the TV contract:

- **`ogs:start` names the couch.** Post
  `{ type: "ogs:start", instanceId: "i1", mode: "new", roster: [], token: "", players: [{ id: "p1", handle: "sam", name: "Sam", avatar: "https://example.com/a.png" }] }`
  and expect `frame.getByText("Sam")` to be visible. Also assert the room code, join QR and cast
  button are gone.
- **`ogs:ready` is said.** Before loading the iframe, collect what the frame posts to the parent:
  `page.exposeFunction("onGameMessage", …)` plus a `message` listener in the parent page. Expect an
  `{ type: "ogs:ready" }`, then answer it with `ogs:start`.
- **Your sitting label comes back.** After `ogs:start`, expect an
  `{ type: "ogs:instance", report: { title: "…" } }` from the frame.
- **No full-screen button when framed.** The launcher already fills the TV:
  `expect(await frame.getByRole("button", { name: /full screen/i }).count()).toBe(0)`. The same page
  opened directly (`page.goto(TV_URL)`) may keep its button.
- **Test at TV sizes.** Run the framed page at 1280×720 and 1920×1080 and check that nothing important
  sits outside the 5% safe area or over the focal area:

  ```ts
  /** Visible elements (except the full-bleed scene) that poke outside the 5% safe area. */
  const outsideSafeArea = (f: Frame) =>
    f.evaluate(() => {
      const w = innerWidth, h = innerHeight, mx = w * 0.05, my = h * 0.05;
      return [...document.querySelectorAll("body *")]
        .filter((el) => !(el instanceof HTMLCanvasElement) && el.checkVisibility())
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.left < mx || r.top < my || r.right > w - mx || r.bottom > h - my))
        .map(({ el }) => el.id || el.tagName);
    });
  expect(await outsideSafeArea(frame)).toEqual([]);
  ```
- **Hidden is not gone.** Playwright's `getByText` and `getByLabel` also count hidden elements: assert
  "no room code on the OGS TV" with `isHidden()` or `getByText(code, { exact: true }).filter({ visible: true })`,
  not `count() === 0`.

## 2. The phone page in a fake WebView

The OGS app injects `window.ReactNativeWebView` and answers the page's `BRIDGE_READY` with each
store's state (`STATE_INIT`). Fake it with an init script, and give the `profile` store a ready
profile whose `token` your test signed:

```ts
const fakeWebView = (stores: Record<string, unknown>) => `
  window.__ogsSent = [];
  window.ReactNativeWebView = {
    postMessage(raw) {
      const msg = JSON.parse(raw);
      window.__ogsSent.push(msg);
      if (msg.type === "BRIDGE_READY") {
        setTimeout(() => {
          for (const [storeKey, data] of Object.entries(${JSON.stringify(stores)}))
            window.dispatchEvent(new MessageEvent("message", {
              data: JSON.stringify({ type: "STATE_INIT", storeKey, data }),
            }));
        }, 50);
      }
    },
  };
`;

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(
  fakeWebView({
    profile: {
      status: "ready",
      profile: { id: "p1", handle: "sam", name: "Sam", avatar: "https://example.com/a.png", token },
    },
  }),
);
const page = await ctx.newPage();
await page.goto(`${BASE}/`);
await expect(page.getByLabel("name")).toHaveCount(0); // no name form inside OGS
```

- **Signing test tokens.** Generate an ES256 key pair with Web Crypto, serve its public JWK at
  `http://localhost:8831/.well-known/jwks.json` from the test (`node:http`), and start your server
  with that `jwksUrl` (for a Worker: `wrangler dev --var OGS_JWKS_URL:http://localhost:8831/.well-known/jwks.json`).
  Sign tokens whose claims match [`GameToken`](messages.md#gametoken) with `aud` = your appId.
- **Assert the server's view**, not just the page: the player is seated under the token's `name`, a
  token for another `appId` or an expired one is not.
- **A room game's host phone** also needs the `cast` store, or `SET_VIEW_URL` (step 8) is never
  dispatched. Its state when the app opens your page:
  `cast: { isAvailable: true, devices: [], session: { status: "disconnected", deviceId: null, deviceName: null, sessionId: null, streamSessionId: null }, error: null, viewUrl: null }`.
  The declared TV page then arrives in `window.__ogsSent` as
  `{ type: "EVENT", storeKey: "cast", event: { type: "SET_VIEW_URL", url } }`.
- **Sitting reports** arrive in `window.__ogsSent` as
  `{ type: "EVENT", storeKey: "ogs", event: { type: "INSTANCE_REPORT", report } }`. Give the fake an
  `ogs` store too (`ogs: { reported: [] }` next to `profile`): profile-kit waits for the store before
  it dispatches.

## Pushes (if your game sends them)

- **Consent in the fake WebView:** give the fake a `notifications` store (`{ answer: null, last: null }`
  next to `profile`). When the page dispatches `{ type: "REQUEST", id }`, answer with a
  `STATE_INIT`/state update `{ answer: { id, result: { status: "granted", handle: "ph_testtesttesttest" } }, last: null }`
  and assert the page sent the handle to your server.
- **Pushes while open:** set `last: { seq: 1, notification: { title, body, url } }` and assert your
  `onOgsNotification` handler ran.
- **Your server's sends:** point `createOgsNotifier`'s `baseUrl` at a local stub that records requests;
  assert who was sent to, that connected seats were skipped, and one push per handoff.
- **Your sw.js:** serve the built `sw.js` from a local page and deliver a push through Chromium's DevTools
  (`ServiceWorker.deliverPushMessage`), then read `registration.getNotifications()`. Use full Chromium:
  Playwright's headless shell has no notifications.

## 3. Still a plain-browser game

OGS games must keep working without OGS. Keep (or add) one end-to-end test that plays a short round
with no fake bridge and no frame: the name form appears, the TV page shows its own join code, and the
round finishes. profile-kit returns `null` and does nothing there, so this mostly guards your own
`if (inOgs)` branches.

## 4. Unit tests for your own logic

Keep the OGS decisions in small pure functions and test them directly: "given this profile snapshot,
show the form or join?", "given this phase, what is the sitting label?", "paused: which sounds stop?".
profile-kit's lower-level functions take their bridge and window as arguments
(`createSessionSource({ win })`, `createProfileSource({ bridge })`), so you can drive them with fakes.

## 5. In the real app

Last, once the seams pass: run the game in the OGS app against the real launcher. Check that phones
skip the name form, the TV names the couch, Home silences the TV, Continue brings it back with sound,
and the Playing tab shows your label. Say which you did: tests passing, deployed, or verified on a
real TV.
