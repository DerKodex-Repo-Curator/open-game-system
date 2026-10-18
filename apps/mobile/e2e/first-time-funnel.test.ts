import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { by, device, element, waitFor } from "detox";

// A stranger household, from nothing to playing (docs/funnel-audit.md). The host installs OGS,
// makes a profile, picks a game and casts it; a guest then scans the TV's QR on a phone that has
// never had OGS: the link opens the app, onboarding comes first, and the phone lands on the couch.
// Every step is timed and its taps counted; E2E_SHOTS gets funnel.json and the screenshots.
//
// Needs the local API the build points at (E2E_OGS_API), the launcher, and a fake Chromecast
// (FAKE_CAST, the build's EXPO_PUBLIC_FAKE_CAST_URL; EXPO_PUBLIC_FAKE_CAST=1).
const API = process.env.E2E_OGS_API ?? "http://localhost:8788";
const CAST = process.env.FAKE_CAST ?? "http://localhost:5181";
const GAME = process.env.FUNNEL_GAME ?? "bake-shop";

type Step = { step: string; ms: number; taps: number; typed: number };
const steps: Step[] = [];
let taps = 0;
let typed = 0;
let t0 = Date.now();

function begin() {
  taps = 0;
  typed = 0;
  t0 = Date.now();
}
function end(step: string) {
  steps.push({ step, ms: Date.now() - t0, taps, typed });
}
async function tap(id: string) {
  taps++;
  await element(by.id(id)).tap();
}
async function type(id: string, text: string) {
  typed++;
  await element(by.id(id)).typeText(text);
}
async function shot(name: string) {
  const path = await device.takeScreenshot(name);
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  copyFileSync(path, join(dir, `${name}.png`));
}
const visible = (id: string, ms = 10000) =>
  waitFor(element(by.id(id)))
    .toBeVisible()
    .withTimeout(ms);

type Tv = {
  loads: number;
  dom: { screen: string | null; frameApp: string | null; starting: boolean } | null;
};
const tv = async (): Promise<Tv> => (await fetch(`${CAST}/launcher`)).json() as Promise<Tv>;
async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms: number): Promise<T> {
  const stop = Date.now() + ms;
  let last = await read();
  while (!ok(last) && Date.now() < stop) {
    await new Promise((r) => setTimeout(r, 300));
    last = await read();
  }
  return last;
}

/** Who is on the couch behind a TV code (the join page's view of it). */
async function couchOf(code: string): Promise<string[]> {
  const res = await fetch(`${API}/api/v1/join/${code}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { couch: { name: string }[] };
  return body.couch.map((s) => s.name);
}

/** Onboarding as a stranger does it: welcome, notifications (Maybe later), name, sticker, Next, Let's go. */
async function onboard(name: string, sticker: string) {
  await visible("onboardingMakeProfile", 20000);
  await tap("onboardingMakeProfile");
  await visible("onboardingMaybeLaterButton");
  await tap("onboardingMaybeLaterButton");
  await visible("profileNameInput");
  await type("profileNameInput", name);
  await element(by.id("profileNameInput")).tapReturnKey();
  await waitFor(element(by.id("profileHandleStatus")))
    .toHaveText("free")
    .withTimeout(10000);
  await element(by.id("profileStickers")).scrollTo("left");
  await tap(`profileSticker-${sticker}`);
  await waitFor(element(by.id("profileNext")))
    .toBeVisible()
    .whileElement(by.id("profileStep"))
    .scroll(150, "down");
  await tap("profileNext");
  await visible("profileDoneGreeting");
  await tap("onboardingLetsGoButton");
}

let code = "";
// A whole walk is several minutes of a stranger's time, slower still on a busy machine.
const WALK_MS = 300_000;

describe("A stranger household, from nothing to playing", () => {
  afterAll(() => {
    const dir = process.env.E2E_SHOTS;
    if (dir) writeFileSync(join(dir, "funnel.json"), `${JSON.stringify(steps, null, 2)}\n`);
    console.log(JSON.stringify(steps));
  });

  it(
    "the host: install → profile → pick a game → cast → the TV plays it",
    async () => {
      begin();
      await device.launchApp({
        newInstance: true,
        delete: true,
        permissions: { notifications: "NO" },
      });
      await visible("onboardingMakeProfile", 30000);
      end("host: first launch to the welcome");
      await shot("funnel-01-welcome");

      begin();
      await onboard("Dana", "bear");
      await waitFor(element(by.id("libraryScreen")))
        .toExist()
        .withTimeout(15000);
      end("host: onboarding (make a profile)");
      await shot("funnel-02-library");

      begin();
      await waitFor(element(by.id(`libraryGame-${GAME}`)))
        .toBeVisible()
        .whileElement(by.id("libraryScreen"))
        .scroll(200, "down");
      await tap(`libraryGame-${GAME}`);
      await visible("gamePlay");
      await tap("gamePlay");
      await visible("castPromptConfirm");
      end("host: pick a game, Play");
      await shot("funnel-03-cast-prompt");

      begin();
      await tap("castPromptConfirm");
      const started = await until(
        tv,
        (t) => t.dom?.screen === "game" && (t.dom.starting || t.dom.frameApp === GAME),
        30000,
      );
      if (started.dom?.screen !== "game")
        throw new Error(`the TV never started ${GAME}: ${JSON.stringify(started.dom)}`);
      end("host: Cast → the game on the TV");
      await shot("funnel-04-playing");

      const launcher = (await (await fetch(`${CAST}/status`)).json()) as { viewUrl: string | null };
      if (!launcher.viewUrl) throw new Error("no launcher on the TV");
      // The TV code: the session its launcher token names, asked of the API with that token.
      const token = new URL(launcher.viewUrl).searchParams.get("token") ?? "";
      const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as {
        sid: string;
      };
      const view = (await (
        await fetch(`${API}/api/v1/sessions/${claims.sid}`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).json()) as { code?: string };
      code = view.code ?? "";
      if (!/^[A-Z2-9]{6}$/.test(code))
        throw new Error(`the TV has no code: ${JSON.stringify(view)}`);
    },
    WALK_MS,
  );

  it(
    "a guest without the app scans the TV's QR: the app opens, onboarding, then on the couch",
    async () => {
      begin();
      await device.launchApp({
        newInstance: true,
        delete: true,
        permissions: { notifications: "NO" },
        url: `https://opengame.org/join/${code}`,
      });
      await visible("onboardingMakeProfile", 30000);
      end("guest: scan → the app opens (installed)");

      begin();
      await onboard("Sam", "owl");
      const couch = await until(
        () => couchOf(code),
        (c) => c.includes("Sam"),
        15000,
      );
      end("guest: onboarding → on the couch");
      await shot("funnel-05-guest");
      if (!couch.includes("Sam"))
        throw new Error(`Sam never reached the couch: ${JSON.stringify(couch)}`);
      await visible("remoteOk", 10000);
    },
    WALK_MS,
  );

  it(
    "a stranger from a game's link (the front door's 'Play on your TV'): the app opens on that game after onboarding",
    async () => {
      begin();
      await device.launchApp({
        newInstance: true,
        delete: true,
        permissions: { notifications: "NO" },
        url: `https://opengame.org/play/${GAME}`,
      });
      await visible("onboardingMakeProfile", 30000);
      end("game link: tap → the app opens (installed)");

      begin();
      await onboard("Kim", "owl");
      await waitFor(element(by.id("gamePage")))
        .toExist()
        .withTimeout(15000);
      await visible("gamePlay");
      end("game link: onboarding → that game's page, Play");
      await shot("funnel-06-game-link");
    },
    WALK_MS,
  );
});
