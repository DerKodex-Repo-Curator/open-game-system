// Fake Chromecast for simulator runs: the app (EXPO_PUBLIC_FAKE_CAST=1) POSTs { viewUrl } to
// /load when it "casts"; this opens that URL in a 1920x1080 browser (the TV), records video, and
// counts loads. A swap that recasts would show up as loads > 1 for the session.
//
//   node fake-chromecast.mjs [--port 5181] [--headed] [--evidence ./evidence]
//   GET  /status  -> { loads, viewUrl, startedAt }
//   POST /load    -> { viewUrl }  (what the receiver's LOAD_VIEW would do)
//   POST /stop    -> closes the TV page (end for tonight / cast dropped)
//   GET  /screenshot -> PNG of the TV now
//   GET  /launcher   -> { screen, frameApp, frameSrc, starting, continueApps, roomName } read from the launcher's DOM
//                       (continueApps: game:<appId> of each paused sitting card on the TV home;
//                        roomName: the header, "<TV name> · <host>'s games";
//                        screenCode: a browser TV's pairing code, while it shows one)

import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { z } from "zod";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const port = Number(flag("port", "5181"));
const headed = args.includes("--headed");
const evidence = resolve(flag("evidence", "./evidence"));
mkdirSync(evidence, { recursive: true });

const LoadSchema = z.object({ viewUrl: z.string().url() });
const state = { loads: 0, viewUrl: null, startedAt: null };
let browser = null;
let context = null;
let page = null;

async function tv() {
  if (!browser)
    browser = await chromium.launch({
      headless: !headed,
      args: ["--autoplay-policy=no-user-gesture-required"],
    });
  if (!context) {
    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: { dir: evidence, size: { width: 1280, height: 720 } },
    });
    page = await context.newPage();
    page.on("console", (m) => console.log(`[tv] ${m.type()}: ${m.text()}`));
  }
  return page;
}

/**
 * /load and /stop one at a time, like a receiver handling its messages in order. A stop arriving
 * while a load is still opening the page (a TV switch superseded mid-way) would otherwise close the
 * recording context under it, and that load never answered.
 */
let queue = Promise.resolve();
const inTurn = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  try {
    if (req.method === "GET" && req.url === "/status") {
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state));
    }
    if (req.method === "POST" && req.url === "/load") {
      const parsed = LoadSchema.safeParse(JSON.parse((await body(req)) || "{}"));
      if (!parsed.success)
        return res.writeHead(400).end(JSON.stringify({ error: parsed.error.issues }));
      await inTurn(async () => {
        // Like the real receiver: the same viewUrl again is a no-op.
        if (parsed.data.viewUrl === state.viewUrl) return;
        const p = await tv();
        state.loads += 1;
        state.viewUrl = parsed.data.viewUrl;
        state.startedAt ??= Date.now();
        console.log(
          `[cast] load #${state.loads} at=${Date.now()}: ${state.viewUrl.replace(/token=[^&]+/, "token=…")}`,
        );
        await p.goto(state.viewUrl, { timeout: 15000 });
      });
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state));
    }
    if (req.method === "POST" && req.url === "/stop") {
      await inTurn(async () => {
        if (context) {
          const video = page?.video();
          await context.close();
          if (video) console.log(`[cast] video: ${await video.path()}`);
        }
        context = null;
        page = null;
        state.viewUrl = null;
      });
      return res.writeHead(200).end(JSON.stringify(state));
    }
    if (req.method === "GET" && req.url === "/launcher") {
      const dom = page
        ? await page.evaluate(() => {
            const frame = document.querySelector('[data-testid="game-frame"]');
            return {
              screen: document.querySelector("[data-screen]")?.getAttribute("data-screen") ?? null,
              frameApp: frame?.getAttribute("data-app") ?? null,
              frameSrc: frame?.getAttribute("src") ?? null,
              starting: Boolean(document.querySelector('[data-testid="starting"]')),
              // Paused sittings on the TV home: the activity cards that continue a game (not tonight's game night).
              continueApps: [
                ...document.querySelectorAll(
                  '[data-row="activity"] [data-card="sitting"]:not([data-upcoming])',
                ),
              ].map((e) => `game:${e.getAttribute("data-app")}`),
              roomName: document.querySelector(".room-name")?.textContent ?? null,
              // A browser TV waiting to pair (2026-10-17-browser-tv.feature): the code it shows.
              screenCode:
                document.querySelector('[data-testid="screen-code"]')?.textContent ?? null,
            };
          })
        : null;
      return res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ ...state, dom }));
    }
    if (req.method === "GET" && req.url === "/screenshot" && page) {
      const png = await page.screenshot();
      return res.writeHead(200, { "content-type": "image/png" }).end(png);
    }
    res.writeHead(404).end();
  } catch (e) {
    console.error(e);
    res.writeHead(500).end(String(e));
  }
});

server.listen(port, "0.0.0.0", () =>
  console.log(`fake Chromecast on :${port} (evidence in ${join(evidence)})`),
);
const shutdown = async () => {
  if (context) await context.close();
  if (browser) await browser.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
