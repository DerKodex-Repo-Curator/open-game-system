import { ScreenCreatedSchema, ScreenStateSchema } from "@open-game-system/ogs-protocol";
import { z } from "zod";

/** The production OGS API: a bare TV page pairs with it. */
export const PRODUCTION_API = "https://opengame-api.jonathanrmumm.workers.dev";

/**
 * The TV page with no launcher link is a screen (2026-10-17-browser-tv.feature): a bare page, or
 * `?screen=1&api=<base>` for another API. A launcher link (`token`), fake mode, or a lone `api`
 * (a broken launcher link) is not.
 */
export function screenParams(search: string): { api: string } | null {
  const q = new URLSearchParams(search);
  if (q.has("token") || q.has("fake")) return null;
  if (q.get("screen") !== "1") return q.has("api") ? null : { api: PRODUCTION_API };
  const api = z
    .string()
    .url()
    .safeParse(q.get("api") ?? PRODUCTION_API);
  return api.success ? { api: api.data.replace(/\/+$/, "") } : null;
}

/** What the screen shows: getting a code, the code, the launcher a phone cast, or no OGS. */
export type PairingView =
  | { kind: "starting" }
  | { kind: "code"; code: string }
  | { kind: "launcher"; token: string }
  | { kind: "offline" };

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const STORAGE_KEY = "ogs.screen";
const SavedSchema = z.object({ screenId: z.string().min(1), secret: z.string().min(1) });
type Saved = z.infer<typeof SavedSchema>;

function load(storage: Storage): Saved | null {
  try {
    const saved = SavedSchema.safeParse(JSON.parse(storage.getItem(STORAGE_KEY) ?? "null"));
    return saved.success ? saved.data : null;
  } catch {
    return null;
  }
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

  async function create(): Promise<Saved | null> {
    const res = await deps.fetch(base, { method: "POST" });
    const made = ScreenCreatedSchema.safeParse(await res.json());
    if (!made.success) return null;
    const saved = { screenId: made.data.screenId, secret: made.data.secret };
    deps.storage.setItem(STORAGE_KEY, JSON.stringify(saved));
    return saved;
  }

  async function tick(): Promise<void> {
    try {
      const screen = load(deps.storage) ?? (await create());
      if (!screen) return set({ kind: "offline" });
      const res = await deps.fetch(`${base}/${screen.screenId}`, {
        headers: { "X-Screen-Secret": screen.secret },
      });
      if (res.status === 404 || res.status === 403) {
        deps.storage.removeItem(STORAGE_KEY);
        return set({ kind: "starting" });
      }
      const state = ScreenStateSchema.safeParse(await res.json());
      if (!state.success) return set({ kind: "offline" });
      set(
        state.data.show
          ? { kind: "launcher", token: state.data.show.token }
          : { kind: "code", code: state.data.code },
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
