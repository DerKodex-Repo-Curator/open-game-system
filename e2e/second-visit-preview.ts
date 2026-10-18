// The second visit (docs/acceptance/2026-10-18-second-visit.feature), end to end on the preview API:
// a household plays a round of Rocket Crew, closes everything, and comes back the next day.
//
// Day 1: the TV page (a laptop on the TV) shows a code, Dana (the phone, Detox:
// apps/mobile/e2e/second-visit-preview.test.ts) casts to it, Grandma joins from the TV's QR in her
// phone's browser, and they play the first round. Then the app, the TV page and Grandma's page all
// close. Day 2: the TV page, Grandma's browser and Dana's phone all run a day ahead (Playwright's
// clock; the phone through an e2e build's launch argument). The TV page is the same screen with the
// same code; Dana casts without a code; the TV home offers Play again with the ring on it; Grandma
// rejoins in one tap; Dana presses OK and they play the first round. The API keeps real time (its
// 12 h sessions and 7-day window are unit-tested).
//
// The TV page and the join page are this branch's builds, made and served here against the preview
// API (FUNNEL_API, FUNNEL_TV):
//   pnpm exec tsx e2e/second-visit-preview.ts           (repo root)
//   env: DETOX_IOS_BINARY (EXPO_PUBLIC_OGS_API=<preview API>, EXPO_PUBLIC_FAKE_CAST=none,
//        EXPO_PUBLIC_E2E_CLOCK=1), DETOX_SIM_NAME, ROCKET_CREW_DIR, FUNNEL_EVIDENCE.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, type BrowserContext, chromium, devices, type Page } from "playwright";
import { z } from "zod";
import {
  createReport,
  createStepServer,
  playFirstRound,
  rocketCrew,
  scanQr,
  sitters,
  sleep,
} from "./lib/rocket-round";

const TV_PORT = 5320;
const SITE_PORT = 5321;
const TV_PAGE = `http://localhost:${TV_PORT}/`;
const SITE = `http://localhost:${SITE_PORT}`;
const PORT = Number(process.env.FUNNEL_COORD_PORT ?? 5393);
const DAY = 24 * 60 * 60 * 1000;
const EVIDENCE = resolve(process.env.FUNNEL_EVIDENCE ?? "evidence/second-visit-preview");
mkdirSync(EVIDENCE, { recursive: true });

const report = createReport();
const { check, mark } = report;
const steps = createStepServer(PORT, mark);
const rocket = await rocketCrew(process.env.ROCKET_CREW_DIR ?? join(homedir(), "src/rocket-crew"));

const API = process.env.FUNNEL_API ?? "https://opengame-api-pr-funnel.jonathanrmumm.workers.dev";
const LAUNCHER = process.env.FUNNEL_TV ?? "https://funnel.ogs-tv.pages.dev";

/**
 * This branch's TV page and join page against the preview API, built here into their own folder
 * (a workspace build elsewhere points the apps' own dist folders at production), then served by vite preview.
 */
function serve(dir: string, port: number): ChildProcess {
  const out = join(tmpdir(), `ogs-second-visit-${port}`);
  const env = { ...process.env, VITE_OGS_API: API, VITE_OGS_TV: LAUNCHER };
  const built = spawnSync("pnpm", ["exec", "vite", "build", "--outDir", out, "--emptyOutDir"], {
    cwd: resolve(dir),
    env,
    stdio: "ignore",
  });
  if (built.status !== 0) throw new Error(`building ${dir} failed`);
  return spawn(
    "pnpm",
    ["exec", "vite", "preview", "--outDir", out, "--port", String(port), "--strictPort"],
    {
      cwd: resolve(dir),
      env,
      stdio: "ignore",
    },
  );
}
async function until(url: string) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`${url} never came up`);
}

/** A laptop on the TV: the TV page, full screen. Its screen id is what this browser kept. */
async function openTv(ctx: BrowserContext): Promise<{ tv: Page; screenId: string }> {
  const tv = await ctx.newPage();
  await tv.goto(TV_PAGE);
  await tv.getByTestId("screen-fullscreen").click();
  // Its code, or (a cast left on overnight, with the API's clock real) yesterday's launcher.
  await tv
    .getByTestId("screen-code")
    .or(tv.getByTestId("home"))
    .first()
    .waitFor({ timeout: 30000 });
  const kept = await tv.evaluate(() => localStorage.getItem("ogs.screen"));
  const screenId =
    z.object({ screenId: z.string() }).safeParse(JSON.parse(kept ?? "null")).data?.screenId ?? "";
  return { tv, screenId };
}
const codeOf = async (tv: Page) =>
  (await tv.getByTestId("screen-code").textContent({ timeout: 30000 }))?.trim() ?? "";

/** Grandma scans the TV's QR with her phone's camera: the join page in her browser. */
async function openJoin(ctx: BrowserContext, tv: Page, scanned: string): Promise<Page> {
  check(
    "the TV's QR is a join link",
    /^https:\/\/opengame\.org\/join\/[A-Z2-9]{6}$/.test(scanned),
    scanned,
  );
  const guest = await ctx.newPage();
  await guest.goto(`${SITE}${new URL(scanned).pathname}`);
  await guest.getByTestId("join-browser").click();
  return guest;
}
async function onCouch(tv: Page, who: string) {
  for (let i = 0; i < 50 && !(await sitters(tv)).includes(who); i++) await sleep(200);
  return (await sitters(tv)).includes(who);
}

const open: Record<string, Page> = {};

async function main() {
  const tvServer = serve("apps/tv", TV_PORT);
  const siteServer = serve("apps/web", SITE_PORT);
  const browser: Browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const phone = spawn(
    "pnpm",
    [
      "exec",
      "detox",
      "test",
      "--configuration",
      process.env.DETOX_CONFIGURATION ?? "ios.sim.release",
      "e2e/second-visit-preview.test.ts",
    ],
    {
      cwd: resolve("apps/mobile"),
      env: { ...process.env, FUNNEL_COORD: `http://localhost:${PORT}` },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  const phoneDone = new Promise<number>((r) => phone.on("exit", (c) => r(c ?? 1)));
  // The phone's half failed: stop waiting for its steps (they would hold the step port for 20 min).
  const phoneFailed = phoneDone.then((c): Promise<never> => {
    if (c !== 0) throw new Error(`the phone's half failed (exit ${c})`);
    return new Promise<never>(() => {});
  });
  async function walk() {
    await until(TV_PAGE);
    await until(`${SITE}/`);
    mark("start");

    // --- Day 1 -------------------------------------------------------------------------------------
    const tvCtx1 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const day1 = await openTv(tvCtx1);
    open.tv = day1.tv;
    const code = await codeOf(day1.tv);
    check("day 1: the TV page shows a code", /^[A-Z2-9]{6}$/.test(code), code);
    steps.post("tv-code", { code });
    await steps.waitStep("cast");
    await day1.tv.getByTestId("home").waitFor({ timeout: 60000 });

    const guestCtx1 = await browser.newContext({ ...devices["iPhone 15"] });
    const couch1 = (await scanQr(day1.tv)) ?? "";
    const guest1 = await openJoin(guestCtx1, day1.tv, couch1);
    open.guest = guest1;
    await guest1.getByTestId("guest-name").fill("Grandma");
    await guest1.getByTestId("guest-sticker-owl").click();
    await guest1.getByTestId("guest-join").click();
    await guest1.getByTestId("guest-remote").waitFor({ timeout: 30000 });
    check("day 1: Grandma is on the couch", await onCouch(day1.tv, "Grandma"));
    steps.post("guest-on-couch");
    await steps.waitStep("host-in-game");
    await playFirstRound({
      tv: day1.tv,
      guest: guest1,
      guestName: "Grandma",
      rocket,
      ...steps,
      check,
    });
    await day1.tv.screenshot({ path: join(EVIDENCE, "01-day1-round.png") });
    steps.post("round-done");

    // Bedtime: everything closes. What the laptop and Grandma's browser keep is their storage.
    await steps.waitStep("phone-closed");
    const tvKept = await tvCtx1.storageState();
    const guestKept = await guestCtx1.storageState();
    await tvCtx1.close();
    await guestCtx1.close();
    mark("everything closed");

    // --- Day 2: a day later ------------------------------------------------------------------------
    const tomorrow = Date.now() + DAY;
    const tvCtx2 = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      storageState: tvKept,
    });
    await tvCtx2.clock.setSystemTime(tomorrow);
    const day2 = await openTv(tvCtx2);
    open.tv = day2.tv;
    check(
      "day 2: the TV page is the same screen as yesterday",
      day2.screenId !== "" && day2.screenId === day1.screenId,
      day2.screenId,
    );
    steps.post("day2-tv-ready");

    const cast = z
      .object({ target: z.string(), openedMs: z.number() })
      .parse(await steps.waitStep("day2-cast"));
    check(
      "day 2: the phone's Cast already names the TV (no code typed)",
      cast.target === "Browser TV",
      cast.target,
    );
    // The TV shows tonight's couch (its QR, a new code), not yesterday's.
    let couch2 = "";
    for (let i = 0; i < 60; i++) {
      couch2 = (await scanQr(day2.tv).catch(() => null)) ?? "";
      if (couch2 && couch2 !== couch1) break;
      await sleep(1000);
    }
    check(
      "day 2: the cast is a new couch (a new join code)",
      couch2 !== "" && couch2 !== couch1,
      `${couch1} → ${couch2}`,
    );
    // Yesterday's game is the first card: Play again (its sitting over), or its sitting to continue
    // (still within the game's TTL). The ring starts on Play again; on a sitting, Dana presses Down.
    const firstCard = day2.tv.locator("[data-row=activity] [data-card]").first();
    await firstCard.waitFor({ timeout: 30000 });
    const kind = (await firstCard.getAttribute("data-card")) ?? "";
    check(
      "day 2: the TV's first card is yesterday's game (Play again, or its sitting)",
      (kind === "again" || kind === "sitting") &&
        (await firstCard.getAttribute("data-app")) === "rocket-crew",
      kind,
    );
    const ringOnCard = (await firstCard.getAttribute("data-focused")) !== null;
    if (kind === "again") check("day 2: the ring starts on Play again", ringOnCard);
    const firstIcon = await day2.tv
      .locator("[data-row=games] [data-item]")
      .first()
      .getAttribute("data-item");
    check(
      "day 2: Rocket Crew is the first game in the TV's row",
      firstIcon === "game:rocket-crew",
      firstIcon ?? "",
    );
    await day2.tv.screenshot({ path: join(EVIDENCE, "02-day2-tv-home.png") });

    const guestCtx2 = await browser.newContext({
      ...devices["iPhone 15"],
      storageState: guestKept,
    });
    await guestCtx2.clock.setSystemTime(tomorrow);
    const guest2 = await openJoin(guestCtx2, day2.tv, couch2);
    open.guest = guest2;
    const joinAgain = guest2.getByTestId("guest-join-again");
    await joinAgain.waitFor({ timeout: 20000 });
    check(
      "day 2: the join page offers Join as Grandma",
      (await joinAgain.textContent())?.trim() === "Join as Grandma",
    );
    await guest2.screenshot({ path: join(EVIDENCE, "03-day2-join-again.png") });
    await joinAgain.click();
    await guest2.getByTestId("guest-remote").waitFor({ timeout: 30000 });
    check("day 2: one tap puts Grandma on the couch", await onCouch(day2.tv, "Grandma"));
    steps.post("day2-guest-on-couch", { down: !ringOnCard });

    const inGame = z
      .object({ castMs: z.number(), okToGameMs: z.number() })
      .parse(await steps.waitStep("day2-host-in-game"));
    await playFirstRound({
      tv: day2.tv,
      guest: guest2,
      guestName: "Grandma",
      rocket,
      ...steps,
      check,
      suffix: "-2",
    });
    await day2.tv.screenshot({ path: join(EVIDENCE, "04-day2-round.png") });
    steps.post("round-done-2");
    const { taps } = z.object({ taps: z.number() }).parse(await steps.waitStep("day2-taps"));
    check(
      "day 2: Dana's taps, app open to the first round",
      taps <= (ringOnCard ? 4 : 5),
      `${taps} taps: TV, Cast, ${ringOnCard ? "" : "Down, "}OK, Ready`,
    );
    const danaMs = inGame.castMs + inGame.okToGameMs;
    check(
      "day 2: Dana's own time, app open to the game on the TV, under 10 s",
      danaMs < 10_000,
      `${(danaMs / 1000).toFixed(1)} s (open ${(cast.openedMs / 1000).toFixed(1)} s, cast ${(inGame.castMs / 1000).toFixed(1)} s, OK to game ${(inGame.okToGameMs / 1000).toFixed(1)} s; Grandma's join in between not counted)`,
      true,
    );
    check("the phone finished its half", (await phoneDone) === 0);
  }
  try {
    await Promise.race([walk(), phoneFailed]);
  } catch (e) {
    check("the walk finished", false, String(e));
    for (const [name, page] of Object.entries(open)) {
      await page.screenshot({ path: join(EVIDENCE, `fail-${name}.png`) }).catch(() => undefined);
      console.log(
        `${name} frames: ${page
          .frames()
          .map((f) => f.url())
          .join(" | ")}`,
      );
    }
    phone.kill("SIGTERM");
  } finally {
    await browser.close();
    steps.close();
    tvServer.kill();
    siteServer.kill();
    writeFileSync(
      join(EVIDENCE, "results.json"),
      `${JSON.stringify({ timeline: report.timeline, results: report.results }, null, 2)}\n`,
    );
  }
  const failed = report.results.filter((r) => !r.ok && !r.soft);
  console.log(failed.length ? `${failed.length} failed` : "all passed");
  process.exit(failed.length ? 1 : 0);
}

await main();
