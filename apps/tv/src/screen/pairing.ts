import { ScreenCreatedSchema, ScreenStateSchema } from "@open-game-system/ogs-protocol";
import { z } from "zod";
import { type LauncherParams, launcherSessionOf } from "../params";

/** The production OGS API: a bare TV page pairs with it. */
export const PRODUCTION_API = "https://opengame-api.jonathanrmumm.workers.dev";

/**
 * The TV page with no launcher link is a screen (2026-10-17-browser-tv.feature): a bare page, or
 * `?screen=1&api=<base>` for another API. A launcher link (`token`), fake mode, or a lone `api` (a
 * broken launcher link) is not. `defaultApi`: the build's API (VITE_OGS_API, for a preview).
 */
export function screenParams(
  search: string,
  defaultApi: string = PRODUCTION_API,
): { api: string } | null {
  const q = new URLSearchParams(search);
  if (q.has("token") || q.has("fake")) return null;
  if (q.get("screen") !== "1") return q.has("api") ? null : { api: defaultApi };
  const api = z
    .string()
    .url()
    .safeParse(q.get("api") ?? defaultApi);
  return api.success ? { api: api.data.replace(/\/+$/, "") } : null;
}

/** What the screen shows: getting a code, the code, the launcher a phone cast, or no OGS. */
export type PairingView =
  | { kind: "starting" }
  | { kind: "code"; code: string }
  | { kind: "launcher"; token: string; app?: string }
  | { kind: "offline" };

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const STORAGE_KEY = "ogs.screen";
const SavedSchema = z.object({ screenId: z.string().min(1), secret: z.string().min(1) });
type Saved = z.infer<typeof SavedSchema>;

/** The screen this browser is, if it kept one (anything unreadable is no screen). */
function load(storage: Storage): Saved | null {
  let kept: unknown;
  try {
    // Stryker disable next-line StringLiteral: equivalent, any text that isn't a kept screen reads as none
    kept = JSON.parse(storage.getItem(STORAGE_KEY) ?? "");
  } catch {}
  const saved = SavedSchema.safeParse(kept);
  return saved.success ? saved.data : null;
}

const same = (a: PairingView, b: PairingView) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The screen's side of pairing. Each tick asks the API what to show (making the screen first if
 * this browser isn't one yet, or the API forgot it). The browser keeps the screen's id and secret,
 * so a reload is the same screen with the same code.
 */
export function createPairing(deps: { api: string; fetch: FetchLike; storage: Storage }) {
  let view: PairingView = { kind: "starting" };
  const listeners = new Set<() => void>();
  const base = `${deps.api}/api/v1/screens`;

  const set = (next: PairingView) => {
    if (same(view, next)) return;
    // A missed poll mid-game is a network blip, not a stop: the launcher stays up.
    if (view.kind === "launcher" && next.kind === "offline") return;
    view = next;
    for (const l of listeners) l();
  };

  /** A new screen (an answer that isn't one throws: the tick says offline). */
  async function create(): Promise<Saved> {
    const res = await deps.fetch(base, { method: "POST" });
    const made = ScreenCreatedSchema.parse(await res.json());
    const saved = { screenId: made.screenId, secret: made.secret };
    deps.storage.setItem(STORAGE_KEY, JSON.stringify(saved));
    return saved;
  }

  async function tick(): Promise<void> {
    try {
      const screen = load(deps.storage) ?? (await create());
      const res = await deps.fetch(`${base}/${screen.screenId}`, {
        headers: { "X-Screen-Secret": screen.secret },
      });
      if (res.status === 404 || res.status === 403) {
        deps.storage.removeItem(STORAGE_KEY);
        return set({ kind: "starting" });
      }
      const state = ScreenStateSchema.parse(await res.json());
      const show = state.show;
      set(
        show
          ? { kind: "launcher", token: show.token, ...(show.app ? { app: show.app } : {}) }
          : { kind: "code", code: state.code },
      );
    } catch {
      set({ kind: "offline" });
    }
  }

  return {
    view: () => view,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    tick,
  };
}

/**
 * The launcher a phone's cast puts on this screen: live on its couch, chromeless for a white-label
 * app's cast (`app`: only that game's TV page, as `chrome=none&app=` does on a Chromecast). null for
 * a token that isn't a launcher's.
 */
export function screenLauncherParams(
  api: string,
  view: Extract<PairingView, { kind: "launcher" }>,
): LauncherParams | null {
  const sessionId = launcherSessionOf(view.token);
  if (!sessionId) return null;
  const live = { mode: "live", api, token: view.token, sessionId } satisfies LauncherParams;
  return view.app ? { ...live, chrome: { appId: view.app } } : live;
}
