// The whole stranger funnel against the preview stack (docs/funnel-audit.md): a catalogue tap on the
// front door, the OGS app on a fresh phone (Detox, apps/mobile/e2e/stranger-funnel-preview.test.ts),
// a browser on the TV (no Chromecast), a guest who joins from the TV's QR with no app, and the first
// round of Rocket Crew played: the Captain (the host's phone) reads the problem, the Fixer (the
// guest's browser) presses the control, and the TV says it's fixed.
//
// Nothing here is production: the API, launcher and site are the preview deploys below, and Rocket
// Crew is the preview copy `rocket-crew-funnel` (it trusts the preview API's keys).
//
//   pnpm exec tsx e2e/stranger-funnel-preview.ts            (from the repo root)
//   env: DETOX_IOS_BINARY (a build against the preview: EXPO_PUBLIC_OGS_API, EXPO_PUBLIC_OGS_TV,
//        EXPO_PUBLIC_FAKE_CAST=none), DETOX_SIM_NAME, ROCKET_CREW_DIR (a rocket-crew checkout, for its
//        problem parser), FUNNEL_EVIDENCE.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import jsQR from "jsqr";
import { type Browser, chromium, devices, type FrameLocator, type Page } from "playwright";
import { PNG } from "pngjs";

const FRONT_DOOR =
  process.env.FUNNEL_FRONT_DOOR ?? "https://ogs-front-door.jonathanrmumm.workers.dev";
const SITE = process.env.FUNNEL_SITE ?? "https://funnel.opengame-org.pages.dev";
const TV_PAGE = process.env.FUNNEL_TV ?? "https://funnel.ogs-tv.pages.dev";
const GAME = "rocket-crew";
const PORT = Number(process.env.FUNNEL_COORD_PORT ?? 5391);
const ROCKET = process.env.ROCKET_CREW_DIR ?? join(homedir(), "src/rocket-crew");
const EVIDENCE = resolve(process.env.FUNNEL_EVIDENCE ?? "evidence/stranger-funnel-preview");
mkdirSync(EVIDENCE, { recursive: true });

const { parseCaptainLine } = await import(join(ROCKET, "src/game/generator.ts"));
const { CONTROLS } = await import(join(ROCKET, "src/game/controls.ts"));

type Check = { name: string; ok: boolean; detail: string; soft?: boolean };
const results: Check[] = [];
const timeline: { step: string; at: number }[] = [];
const t0 = Date.now();
const check = (name: string, ok: unknown, detail = "", soft = false) => {
  results.push({ name, ok: Boolean(ok), detail, soft });
  console.log(`${ok ? "PASS" : soft ? "WARN" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const mark = (step: string) => {
  timeline.push({ step, at: Math.round((Date.now() - t0) / 100) / 10 });
  console.log(`  [${timeline[timeline.length - 1]?.at}s] ${step}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Step server for the Detox half (/step/<name> posts, /wait/<name> holds up to 20 s) ---------
const steps = new Map<string, unknown>();
const waiters = new Map<string, ((v: unknown) => void)[]>();
function post(name: string, body: unknown = {}) {
  steps.set(name, body);
  for (const w of waiters.get(name) ?? []) w(body);
  waiters.delete(name);
  mark(name);
}
function waitStep(name: string, ms = 1_200_000): Promise<unknown> {
  if (steps.has(name)) return Promise.resolve(steps.get(name));
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timed out waiting for the phone: ${name}`)), ms);
    waiters.set(name, [...(waiters.get(name) ?? []), (v) => (clearTimeout(t), res(v))]);
  });
}
const server = createServer(async (req, res) => {
  const [, kind, name = ""] = (req.url ?? "").split("/");
  if (req.method === "POST" && kind === "step") {
    let raw = "";
    for await (const c of req) raw += c;
    post(name, raw ? JSON.parse(raw) : {});
    return res.writeHead(204).end();
  }
  if (req.method === "GET" && kind === "wait") {
    const got = await Promise.race([
      waitStep(name).catch(() => undefined),
      sleep(20_000).then(() => undefined),
    ]);
    if (got === undefined) return res.writeHead(204).end();
    return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(got));
  }
  res.writeHead(404).end();
});
server.listen(PORT);

/** The Detox half, on the simulator. */
function runPhone() {
  return spawn(
    "pnpm",
    [
      "exec",
      "detox",
      "test",
      "--configuration",
      "ios.sim.release",
      "e2e/stranger-funnel-preview.test.ts",
    ],
    {
      cwd: resolve("apps/mobile"),
      env: { ...process.env, FUNNEL_COORD: `http://localhost:${PORT}` },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
}

async function scanQr(page: Page): Promise<string | null> {
  const png = PNG.sync.read(await page.getByTestId("join-qr").screenshot());
  return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data ?? null;
}

/** The front door: tap the game's card, then read where "Open in OGS" goes. */
async function catalogueTap(browser: Browser): Promise<string> {
  const ctx = await browser.newContext({ ...devices["iPhone 15"] });
  const page = await ctx.newPage();
  await page.goto(FRONT_DOOR);
  await page.locator(`a[href="/go/${GAME}"]`).first().click();
  const open = page.locator(`a[data-open][data-app="${GAME}"]`);
  await open.waitFor({ timeout: 15000 });
  const href = (await open.getAttribute("href")) ?? "";
  await page.screenshot({ path: join(EVIDENCE, "01-front-door.png") });
  // The game link is opengame.org/play/<appId>: on the preview, the same path on the preview site.
  const usesGameLink = new RegExp(`/play/${GAME}(?:[/?#]|$)`).test(href);
  check(
    "the front door's Open in OGS is the game link (opengame.org/play/<appId>)",
    usesGameLink,
    href,
    true,
  );
  await page.goto(`${SITE}/play/${GAME}`);
  const app = (await page.getByTestId("open-in-app").getAttribute("href")) ?? "";
  check(
    "the game link's page opens the OGS app on that game",
    app === `opengame://play/${GAME}`,
    app,
  );
  await ctx.close();
  return app;
}

/** The pages so far, for screenshots when a step fails. */
const open: Record<string, Page> = {};

async function main() {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const phone = runPhone();
  const phoneDone = new Promise<number>((r) => phone.on("exit", (c) => r(c ?? 1)));
  try {
    mark("start");
    post("app-link", { url: await catalogueTap(browser) });

    // The TV: a laptop on HDMI opens the TV page, clicks full screen, shows its code.
    const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const tv = await tvCtx.newPage();
    open.tv = tv;
    await tv.goto(TV_PAGE);
    await tv.getByTestId("screen-fullscreen").click();
    const code =
      (await tv.getByTestId("screen-code").textContent({ timeout: 20000 }))?.trim() ?? "";
    check("the TV page shows a code to pair with", /^[A-Z2-9]{6}$/.test(code), code);
    await waitStep("onboarded");
    post("tv-code", { code });

    await waitStep("cast");
    await tv.getByTestId("home").waitFor({ timeout: 30000 });
    check("the phone's cast shows the launcher on the browser TV", true);
    await tv.screenshot({ path: join(EVIDENCE, "02-tv-home.png") });

    // The guest scans the TV's QR and joins from the browser.
    const scanned = await scanQr(tv);
    check(
      "the TV's QR is a join link",
      /^https:\/\/opengame\.org\/join\/[A-Z2-9]{6}$/.test(scanned ?? ""),
      scanned ?? "",
    );
    const guestCtx = await browser.newContext({ ...devices["iPhone 15"] });
    const guest = await guestCtx.newPage();
    open.guest = guest;
    await guest.goto(`${SITE}${new URL(scanned ?? "https://x/").pathname}`);
    await guest.getByTestId("join-browser").click();
    await guest.getByTestId("guest-name").fill("Grandma");
    await guest.getByTestId("guest-sticker-owl").click();
    await guest.getByTestId("guest-join").click();
    await guest.getByTestId("guest-remote").waitFor({ timeout: 20000 });
    const sitters = async () => tv.locator("[data-testid=couch] figcaption").allTextContents();
    for (let i = 0; i < 50 && !(await sitters()).includes("Grandma"); i++) await sleep(200);
    check(
      "the guest is on the TV's couch",
      (await sitters()).includes("Grandma"),
      (await sitters()).join(", "),
    );
    post("guest-on-couch");

    // Dana starts Rocket Crew: the TV frames it, the guest's phone follows into its room.
    await waitStep("host-in-game");
    const tvGame: FrameLocator = tv.frameLocator('[data-testid="game-frame"]');
    await tvGame.locator(".tv").first().waitFor({ state: "attached", timeout: 120000 });
    check("the TV frames Rocket Crew", true);
    await guest.getByTestId("guest-game").waitFor({ timeout: 120000 });
    const fixer = guest.frameLocator('[data-testid="guest-game-frame"]');
    // Rocket Crew asks a browser guest its name (no OGS identity in the browser), then its lobby.
    const nameBox = fixer.getByRole("textbox", { name: "name" });
    const ready = fixer.getByRole("button", { name: "ready", exact: true });
    await nameBox.or(ready).first().waitFor({ timeout: 90000 });
    if (await nameBox.isVisible()) {
      await nameBox.fill("Grandma");
      await fixer.getByRole("button", { name: "Join", exact: true }).click();
    }
    // The Fixer's lobby: Ready (a big green play button), then launch once the Captain is ready.
    await ready.waitFor({ timeout: 30000 });
    check("the guest is the Fixer", true);
    await ready.click({ force: true });
    await waitStep("captain-ready");
    await fixer.locator(".launch-button.pulse").waitFor({ timeout: 30000 });
    await fixer.getByRole("button", { name: "launch" }).dispatchEvent("pointerdown");
    await tvGame.locator(".tv.phase-problem").waitFor({ timeout: 30000 });
    await guest.screenshot({ path: join(EVIDENCE, "03-guest-fixer.png") });
    post("launched");

    // Round 1: the Captain reads the line; the Fixer presses what it says.
    const { line } = (await waitStep("captain-line")) as { line: string };
    const problem = parseCaptainLine(line);
    check(
      "the Captain's first problem is one the Fixer can fix",
      problem.expect.length > 0,
      `${line} → ${problem.kind}`,
    );
    for (const action of problem.expect as { control: string; value?: string }[]) {
      const spec = CONTROLS[action.control] as { color: string; kind: string };
      if (spec.kind === "lever") {
        const box = await fixer.getByRole("slider", { name: "orange" }).boundingBox();
        if (!box) throw new Error("no lever");
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await guest.mouse.move(x, y);
        await guest.mouse.down();
        const dir = action.value === "up" ? -1 : 1;
        for (let i = 1; i <= 10; i++)
          await guest.mouse.move(x, y + (dir * i * box.height) / 22, { steps: 2 });
        await guest.mouse.up();
      } else
        await fixer.getByRole("button", { name: spec.color, exact: true }).click({ force: true });
      await sleep(800);
    }
    await tvGame.locator(".tv.phase-success").waitFor({ timeout: 20000 });
    check("the first round is played: the TV says it's fixed", true);
    await tv.screenshot({ path: join(EVIDENCE, "04-tv-round-fixed.png") });
    post("round-done");
    check("the host's phone finished its half", (await phoneDone) === 0);
  } catch (e) {
    check("the funnel finished", false, String(e));
    for (const [name, page] of Object.entries(open)) {
      await page.screenshot({ path: join(EVIDENCE, `fail-${name}.png`) }).catch(() => undefined);
      const frames = page.frames().map((f) => f.url());
      console.log(`${name} frames: ${frames.join(" | ")}`);
    }
    phone.kill("SIGTERM");
  } finally {
    await browser.close();
    server.close();
    writeFileSync(
      join(EVIDENCE, "results.json"),
      `${JSON.stringify({ timeline, results }, null, 2)}\n`,
    );
  }
  const failed = results.filter((r) => !r.ok && !r.soft);
  console.log(failed.length ? `${failed.length} failed` : "all passed");
  process.exit(failed.length ? 1 : 0);
}

await main();
