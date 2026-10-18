// Shared by the couch walks on the preview stack: the step server the Detox half talks to, the TV's
// QR, and one round of Rocket Crew (the Captain is the host's phone under Detox, the Fixer a guest's
// browser). Lifted from e2e/stranger-funnel-preview.ts.
import { createServer } from "node:http";
import { join } from "node:path";
import jsQR from "jsqr";
import type { FrameLocator, Page } from "playwright";
import { PNG } from "pngjs";
import { z } from "zod";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Check = { name: string; ok: boolean; detail: string; soft?: boolean };

/** Checks and a timeline, printed as they happen and written to results.json at the end. */
export function createReport() {
  const results: Check[] = [];
  const timeline: { step: string; at: number }[] = [];
  const t0 = Date.now();
  return {
    results,
    timeline,
    check(name: string, ok: unknown, detail = "", soft = false) {
      results.push({ name, ok: Boolean(ok), detail, soft });
      console.log(
        `${ok ? "PASS" : soft ? "WARN" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`,
      );
    },
    mark(step: string) {
      timeline.push({ step, at: Math.round((Date.now() - t0) / 100) / 10 });
      console.log(`  [${timeline[timeline.length - 1]?.at}s] ${step}`);
    },
  };
}

/** The Detox half's step server: POST /step/<name> posts, GET /wait/<name> holds up to 20 s. */
export function createStepServer(port: number, mark: (step: string) => void) {
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
      waiters.set(name, [
        ...(waiters.get(name) ?? []),
        (v) => {
          clearTimeout(t);
          res(v);
        },
      ]);
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
  server.listen(port);
  return { post, waitStep, close: () => server.close() };
}

/** The TV's join QR, read off the screen. */
export async function scanQr(page: Page): Promise<string | null> {
  const png = PNG.sync.read(await page.getByTestId("join-qr").screenshot());
  return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data ?? null;
}

/** Who sits on the TV's couch (the launcher's couch strip). */
export const sitters = (tv: Page) => tv.locator("[data-testid=couch] figcaption").allTextContents();

/** Rocket Crew's parser and controls, from a checkout (the orchestrator plays the Fixer). */
export async function rocketCrew(dir: string) {
  const { parseCaptainLine } = await import(join(dir, "src/game/generator.ts"));
  const { CONTROLS } = await import(join(dir, "src/game/controls.ts"));
  return {
    parseCaptainLine: (line: string) =>
      z
        .object({
          kind: z.string(),
          expect: z.array(z.object({ control: z.string(), value: z.string().optional() })),
        })
        .parse(parseCaptainLine(line)),
    control: (id: string) => z.object({ color: z.string(), kind: z.string() }).parse(CONTROLS[id]),
  };
}
type Rocket = Awaited<ReturnType<typeof rocketCrew>>;

/**
 * One round, the browser half: the guest follows into the game as the Fixer, readies, launches
 * once the Captain is ready, presses what the Captain's line says, and the TV says it's fixed.
 * `waitStep`/`post` are the step server's: captain-ready and captain-line come from the phone.
 */
export async function playFirstRound(opts: {
  tv: Page;
  guest: Page;
  guestName: string;
  rocket: Rocket;
  waitStep: (name: string) => Promise<unknown>;
  post: (name: string, body?: unknown) => void;
  check: (name: string, ok: unknown, detail?: string) => void;
  /** Appended to the step names (a second round in the same walk: "-2"). */
  suffix?: string;
}) {
  const { tv, guest, rocket, check } = opts;
  const s = opts.suffix ?? "";
  const waitStep = (name: string) => opts.waitStep(`${name}${s}`);
  const post = (name: string) => opts.post(`${name}${s}`);
  const tvGame: FrameLocator = tv.frameLocator('[data-testid="game-frame"]');
  // The game arriving: slowest on an emulator under load (the phone WebView loads it).
  await tvGame.locator(".tv").first().waitFor({ state: "attached", timeout: 300000 });
  check("the TV frames Rocket Crew", true);
  await guest.getByTestId("guest-game").waitFor({ timeout: 300000 });
  const fixer = guest.frameLocator('[data-testid="guest-game-frame"]');
  // Rocket Crew asks a browser guest its name (no OGS identity in the browser), then its lobby.
  const nameBox = fixer.getByRole("textbox", { name: "name" });
  const ready = fixer.getByRole("button", { name: "ready", exact: true });
  await nameBox.or(ready).first().waitFor({ timeout: 90000 });
  if (await nameBox.isVisible()) {
    await nameBox.fill(opts.guestName);
    await fixer.getByRole("button", { name: "Join", exact: true }).click();
  }
  await ready.waitFor({ timeout: 120000 });
  check("the guest is the Fixer", true);
  await ready.click({ force: true });
  await waitStep("captain-ready");
  await fixer.locator(".launch-button.pulse").waitFor({ timeout: 90000 });
  await fixer.getByRole("button", { name: "launch" }).dispatchEvent("pointerdown");
  await tvGame.locator(".tv.phase-problem").waitFor({ timeout: 90000 });
  post("launched");

  const { line } = z.object({ line: z.string() }).parse(await waitStep("captain-line"));
  const problem = rocket.parseCaptainLine(line);
  check(
    "the Captain's first problem is one the Fixer can fix",
    problem.expect.length > 0,
    `${line} → ${problem.kind}`,
  );
  // The success phase lasts a moment: record it when it happens, rather than poll for it.
  // No named functions inside: tsx wraps those in a __name helper the page doesn't have.
  await tvGame
    .locator(".tv")
    .first()
    .evaluate((el) => {
      const doc = el.ownerDocument;
      if (doc.querySelector(".tv.phase-success")) doc.documentElement.dataset.sawSuccess = "true";
      new MutationObserver(() => {
        if (doc.querySelector(".tv.phase-success")) doc.documentElement.dataset.sawSuccess = "true";
      }).observe(doc, {
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
        childList: true,
      });
    });
  for (const action of problem.expect) {
    const spec = rocket.control(action.control);
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
  await tvGame
    .locator("html[data-saw-success='true']")
    .waitFor({ state: "attached", timeout: 60000 });
  check("the first round is played: the TV says it's fixed", true);
}
