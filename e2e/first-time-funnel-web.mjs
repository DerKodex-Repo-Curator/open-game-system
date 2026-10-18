// A stranger's guest, no app (docs/funnel-audit.md #4; join-and-invite.feature "A guest joins from
// the browser without the app"): the real launcher is the TV; a phone browser reads the TV's QR,
// joins from opengame.org/join/<code> with a name and a sticker, is on the TV's couch, has the
// remote, follows the TV into the game's phone page (in the TV's room) and back to the remote on
// Home. Times each step. The host's phone is a scripted couch client (the app's protocol).
//
// Needs running: API (OGS_API) with CATALOGUE_START_URLS {"bake-shop": "<FIXTURE_GAME>/"}, the
// launcher (OGS_TV, built from this branch), the web site (OGS_WEB, VITE_OGS_API=<OGS_API>), the
// fixture game (FIXTURE_GAME).
//   node first-time-funnel-web.mjs [--evidence <dir>]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import jsQR from "jsqr";
import { chromium, devices } from "playwright";
import { PNG } from "pngjs";
import WebSocket from "ws";

const API = process.env.OGS_API ?? "http://127.0.0.1:8868";
const TV = process.env.OGS_TV ?? "http://localhost:5300";
const WEB = process.env.OGS_WEB ?? "http://localhost:5303";
const GAME = process.env.FIXTURE_GAME ?? "http://localhost:5302";
const argEvidence = process.argv.indexOf("--evidence");
const EVIDENCE = resolve(
  argEvidence > 0 ? process.argv[argEvidence + 1] : "./evidence/first-time-funnel-web",
);
mkdirSync(EVIDENCE, { recursive: true });

const results = [];
const steps = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(read, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}
let t0 = Date.now();
const step = (name, taps) => {
  steps.push({ step: name, ms: Date.now() - t0, taps });
  t0 = Date.now();
};

async function post(path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
let exit = 0;
try {
  // The host: a profile and a cast (what the app does when Dana taps Cast).
  const tag = Date.now().toString(36);
  const dana = await post("/api/v1/profiles", {
    name: "Dana",
    handle: `dana.${tag}`,
    sticker: "bear",
    device: { deviceId: `funnel-dana-${tag}`, kind: "phone", name: "Dana's phone" },
  });
  const cast = await post("/api/v1/sessions", { tvName: "Living room TV" }, dana.token);
  const danaPhone = new WebSocket(
    `${API.replace(/^http/, "ws")}/api/v1/couch/ws?token=${encodeURIComponent(dana.token)}&session=${cast.sessionId}`,
  );
  await new Promise((r, j) => {
    danaPhone.once("open", r);
    danaPhone.once("error", j);
  });

  // The TV: the real launcher.
  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvCtx.newPage();
  await tv.goto(`${TV}/?api=${encodeURIComponent(API)}&token=${encodeURIComponent(cast.token)}`);
  await tv.getByTestId("home").waitFor({ timeout: 20000 });
  await tv.screenshot({ path: join(EVIDENCE, "01-tv-home.png") });

  // The older game link (the front door's today) opened without the app: not a 404 (bug bash
  // bb-001, 2026-10-18): the app, or the game's page in the browser.
  {
    const ctx = await browser.newContext({ ...devices["iPhone 15"] });
    const page = await ctx.newPage();
    const game = "https://bake-shop.jonathanrmumm.workers.dev/";
    await page.goto(`${WEB}/open?url=${encodeURIComponent(game)}`);
    await page.getByTestId("open-link").waitFor({ timeout: 15000 });
    const text = await page.locator("body").innerText();
    check(
      "opengame.org/open?url= isn't a 404 without the app",
      !/404/.test(text),
      text.slice(0, 80),
    );
    check(
      "it offers the app and the game's page",
      (await page.getByTestId("open-in-app").getAttribute("href")) ===
        `opengame://open?url=${encodeURIComponent(game)}` &&
        (await page.getByTestId("open-in-browser").getAttribute("href")) === game,
    );
    await ctx.close();
  }

  // The guest scans the QR: decoded off the TV, as a phone camera would.
  t0 = Date.now();
  const png = PNG.sync.read(await tv.getByTestId("join-qr").screenshot());
  const scanned = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data ?? null;
  check(
    "the TV's QR is opengame.org/join/<its code>",
    scanned === `https://opengame.org/join/${cast.code}`,
    scanned ?? "unreadable",
  );
  const phoneCtx = await browser.newContext({ ...devices["iPhone 15"] });
  const phone = await phoneCtx.newPage();
  // opengame.org is this branch's site, served locally.
  await phone.goto(
    `${WEB}${new URL(scanned ?? `https://opengame.org/join/${cast.code}`).pathname}`,
  );
  await phone.getByTestId("join-title").waitFor({ timeout: 15000 });
  check(
    "the join page names the host's couch",
    (await phone.getByTestId("join-title").textContent()) === "Join Dana's couch",
  );
  step("guest: scan → join page", 0);
  await phone.screenshot({ path: join(EVIDENCE, "02-phone-join.png") });

  await phone.getByTestId("join-browser").click();
  await phone.getByTestId("guest-name").fill("Grandma");
  await phone.getByTestId("guest-sticker-owl").click();
  await phone.getByTestId("guest-join").click();
  await phone.getByTestId("guest-remote").waitFor({ timeout: 15000 });
  step("guest: Join from this browser, name, sticker, Join → the remote", 4);
  await phone.screenshot({ path: join(EVIDENCE, "03-phone-remote.png") });

  const sitters = await until(async () => {
    const names = await tv.locator("[data-testid=couch] figcaption").allTextContents();
    return names.includes("Grandma") ? names : null;
  }, "Grandma on the TV's couch");
  check("the TV shows the guest on the couch", sitters.includes("Grandma"), sitters.join(", "));
  await tv.screenshot({ path: join(EVIDENCE, "04-tv-couch.png") });

  // Dana starts Bake Shop; its TV page names room OVEN: every phone follows into it.
  danaPhone.send(
    JSON.stringify({
      type: "game.start",
      appId: "bake-shop",
      mode: "new",
      hostDeviceId: `funnel-dana-${tag}`,
    }),
  );
  danaPhone.send(
    JSON.stringify({
      type: "game.view",
      appId: "bake-shop",
      url: `${GAME}/tv?game=Bake%20Shop&label=Day%201&room=OVEN`,
    }),
  );
  t0 = Date.now();
  await phone.getByTestId("guest-game").waitFor({ timeout: 20000 });
  const src = await phone.getByTestId("guest-game-frame").getAttribute("src");
  check(
    "the guest's phone opens the game's phone page in the TV's room",
    src === `${GAME}/?ogsRoom=OVEN`,
    src ?? "",
  );
  step("guest: the TV starts a game → the guest's phone opens it (0 taps)", 0);
  await phone.screenshot({ path: join(EVIDENCE, "05-phone-game.png") });

  danaPhone.send(JSON.stringify({ type: "home" }));
  await phone.getByTestId("guest-remote").waitFor({ timeout: 15000 });
  check("Home brings the guest back to the remote", true);
  step("guest: Home → back to the remote", 0);

  // The guest has the remote too: a press moves the TV's focus.
  const focused = () =>
    tv.evaluate(() => document.querySelector("[data-focused]")?.getAttribute("data-item") ?? null);
  const before = await focused();
  await phone.getByRole("button", { name: "Right" }).click();
  const after = await until(async () => {
    const f = await focused();
    return f !== before ? f : null;
  }, "the TV's focus to move");
  check("the guest's remote moves the TV's focus", after !== before, `${before} → ${after}`);
  danaPhone.close();
} catch (e) {
  check("the walk finished", false, String(e));
} finally {
  await browser.close();
  writeFileSync(join(EVIDENCE, "results.json"), `${JSON.stringify({ steps, results }, null, 2)}\n`);
  exit = results.every((r) => r.ok) ? 0 : 1;
  console.log(JSON.stringify(steps));
}
process.exit(exit);
