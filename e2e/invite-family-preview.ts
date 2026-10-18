// Invite another family across two households on the preview (2026-10-18-invite-another-family
// .feature). Two browser TVs (the Okafors' and the Lees'), the Lees' phone browser, and the phones'
// half in Detox (apps/mobile/e2e/invite-family-preview.test.ts). Checks the whole funnel on the
// invite's counts: invite_sent (it exists) → link_opened → testflight_tap → first_session.
//
//   pnpm exec tsx e2e/invite-family-preview.ts      (from the repo root)
//   env: DETOX_IOS_BINARY (a preview build: EXPO_PUBLIC_OGS_API, EXPO_PUBLIC_OGS_TV,
//        EXPO_PUBLIC_FAKE_CAST=none), DETOX_SIM_NAME, FUNNEL_EVIDENCE. The preview site must be
//        built with VITE_OGS_GET_APP (the "Get OGS" link the Lees tap).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { type Browser, chromium, devices, type Page } from "playwright";
import { z } from "zod";

const API = process.env.FUNNEL_API ?? "https://opengame-api-pr-funnel.jonathanrmumm.workers.dev";
const SITE = process.env.FUNNEL_SITE ?? "https://funnel.opengame-org.pages.dev";
const TV_PAGE = process.env.FUNNEL_TV ?? "https://funnel.ogs-tv.pages.dev";
const PORT = Number(process.env.FUNNEL_COORD_PORT ?? 5392);
const EVIDENCE = resolve(process.env.FUNNEL_EVIDENCE ?? "evidence/invite-family-preview");
mkdirSync(EVIDENCE, { recursive: true });

type Check = { name: string; ok: boolean; detail: string };
const results: Check[] = [];
const timeline: { step: string; at: number }[] = [];
const t0 = Date.now();
const check = (name: string, ok: unknown, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const mark = (step: string) => {
  timeline.push({ step, at: Math.round((Date.now() - t0) / 100) / 10 });
  console.log(`  [${timeline[timeline.length - 1]?.at}s] ${step}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Step server for the phones (/step/<name> posts, /wait/<name> holds up to 20 s) -------------
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

/** A laptop on a TV: the TV page, full screen, its pairing code. */
async function browserTv(browser: Browser, name: string): Promise<{ page: Page; code: string }> {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.goto(TV_PAGE);
  await page.getByTestId("screen-fullscreen").click();
  const code =
    (await page.getByTestId("screen-code").textContent({ timeout: 60000 }))?.trim() ?? "";
  check(`${name}'s TV page shows a code`, /^[A-Z2-9]{6}$/.test(code), code);
  return { page, code };
}

const StatsSchema = z.object({
  opened: z.number(),
  testflightTaps: z.number(),
  firstSession: z.boolean(),
});
const NONE = { opened: -1, testflightTaps: -1, firstSession: false };
const Stats = (v: unknown) => StatsSchema.safeParse(v).data ?? NONE;

async function main() {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const phone = spawn(
    "pnpm",
    [
      "exec",
      "detox",
      "test",
      "--configuration",
      process.env.DETOX_CONFIGURATION ?? "ios.sim.release",
      "e2e/invite-family-preview.test.ts",
    ],
    {
      cwd: resolve("apps/mobile"),
      env: { ...process.env, FUNNEL_COORD: `http://localhost:${PORT}` },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  const phoneDone = new Promise<number>((r) => phone.on("exit", (c) => r(c ?? 1)));
  try {
    mark("start");
    const okafors = await browserTv(browser, "the Okafors");
    post("dana-tv-code", { code: okafors.code });
    await waitStep("dana-played");

    // Dana stops and invites another family.
    const { link } = z.object({ link: z.string() }).parse(await waitStep("invite-link"));
    const inv = /[?&]inv=([0-9a-f-]{36})/.exec(link)?.[1] ?? "";
    check(
      "Stop casting offers Invite another family: a game link with an invite",
      /\/play\/rocket-crew\?inv=/.test(link) && inv,
      link,
    );
    const statsUrl = `${API}/api/v1/family-invites/${inv}`;
    const stats = async () => Stats(await (await fetch(statsUrl)).json());
    check(
      "funnel.invite_sent: the invite exists, nothing counted yet",
      (await stats()).opened === 0,
      JSON.stringify(await stats()),
    );

    // The Lees open it on a phone with no OGS app.
    const leeCtx = await browser.newContext({ ...devices["iPhone 15"] });
    const lee = await leeCtx.newPage();
    // TestFlight is Apple's page: stop there (the tap is what counts).
    for (const host of ["https://testflight.apple.com/**", "https://beta.itunes.apple.com/**"])
      await leeCtx.route(host, (r) => r.fulfill({ status: 200, body: "TestFlight" }));
    await lee.goto(`${SITE}${new URL(link).pathname}${new URL(link).search}`);
    await lee.getByTestId("open-in-app").waitFor({ timeout: 30000 });
    await lee.screenshot({ path: join(EVIDENCE, "01-lee-invite-page.png") });
    for (let i = 0; i < 20 && (await stats()).opened !== 1; i++) await sleep(500);
    check(
      "funnel.link_opened: the page counted the visit",
      (await stats()).opened === 1,
      JSON.stringify(await stats()),
    );
    const appLink = (await lee.getByTestId("open-in-app").getAttribute("href")) ?? "";
    check(
      "the page's app link keeps the invite",
      appLink === `opengame://play/rocket-crew?inv=${inv}`,
      appLink,
    );
    await lee.getByTestId("get-app").click();
    for (let i = 0; i < 20 && (await stats()).testflightTaps !== 1; i++) await sleep(500);
    check(
      "funnel.testflight_tap: the Get OGS tap counted",
      (await stats()).testflightTaps === 1,
      JSON.stringify(await stats()),
    );

    // They install OGS and open the invite's app link: their first couch counts.
    const lees = await browserTv(browser, "the Lees");
    post("lee-app-link", { url: appLink });
    post("lee-tv-code", { code: lees.code });
    await waitStep("lee-cast");
    await lees.page.getByTestId("home").waitFor({ timeout: 60000 });
    await lees.page.screenshot({ path: join(EVIDENCE, "02-lees-tv.png") });
    for (let i = 0; i < 20 && (await stats()).firstSession !== true; i++) await sleep(500);
    check(
      "funnel.first_session: the Lees' first couch counted for Dana's invite",
      (await stats()).firstSession === true,
      JSON.stringify(await stats()),
    );
    post("done");
    check("the phones finished", (await phoneDone) === 0);
  } catch (e) {
    check("the walk finished", false, String(e));
    phone.kill("SIGTERM");
  } finally {
    await browser.close();
    server.close();
    writeFileSync(
      join(EVIDENCE, "results.json"),
      `${JSON.stringify({ timeline, results }, null, 2)}\n`,
    );
  }
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `${failed.length} failed` : "all passed");
  process.exit(failed.length ? 1 : 0);
}

await main();
