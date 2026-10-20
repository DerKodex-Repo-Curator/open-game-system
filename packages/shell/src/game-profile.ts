import type { Store } from "@open-game-system/app-bridge-types";
import type { ProfileBridgeState } from "@open-game-system/ogs-protocol";
import { z } from "zod";
import { createApiRequest, OgsApiError, type OgsApiOptions } from "./api-request";
import { backgroundTimeout } from "./background-timer";

/**
 * Games know who you are (slice 3): the game WebView's `profile` bridge store. When a game opens,
 * the app asks OGS for a token for that game (POST /games/:appId/token: aud = appId, 1 h) and gives
 * the page `{ id, handle, name, avatar, token }`; it refreshes the token before it expires. The
 * app's own profile token never reaches the page.
 */

const GrantSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.number(),
  profile: z.object({
    id: z.string().min(1),
    handle: z.string().min(1),
    name: z.string().min(1),
    avatar: z.string().url(),
  }),
});
export type GameGrant = z.infer<typeof GrantSchema>;

/**
 * POST /api/v1/games/:appId/token with this device's profile token. With the couch session this
 * phone is on (`sessionId`), the token names that couch (spec §7).
 */
export function createGameTokenClient(opts: OgsApiOptions & { sessionId?: () => string | null }) {
  const { request, parse } = createApiRequest(opts);
  return async (appId: string): Promise<GameGrant> => {
    const sid = opts.sessionId?.() ?? null;
    return parse(
      GrantSchema,
      await request(`/api/v1/games/${encodeURIComponent(appId)}/token`, {
        method: "POST",
        authed: true,
        ...(sid ? { body: { sid } } : {}),
      }),
    );
  };
}

export type ProfileEvents = { type: "REFRESH" };
export type ProfileStores = { profile: { state: ProfileBridgeState; events: ProfileEvents } };

/** Refresh this long before the token expires; retry a failed refresh this often. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;
export const RETRY_MS = 60 * 1000;

const NONE: ProfileBridgeState = { status: "none" };

/** Expected for a new app whose game isn't listed yet: a note for the developer, not a warning. */
const notListed = (appId: string) =>
  `[ogs] "${appId}" is not in the OGS catalogue yet, so your page gets profile null ` +
  "(as in a plain browser). Profiles start once the game is listed: " +
  "https://ogs-docs.pages.dev/art-and-catalogue#submit-to-the-catalogue";

export function createGameProfile(opts: { fetchToken: (appId: string) => Promise<GameGrant> }) {
  let state: ProfileBridgeState = NONE;
  let appId: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on every open/close: answers for an older game are dropped. */
  let generation = 0;
  const listeners = new Set<(s: ProfileBridgeState) => void>();

  const set = (next: ProfileBridgeState) => {
    state = next;
    for (const l of listeners) l(state);
  };
  // Stryker disable next-line BlockStatement: equivalent, a refresh that fires after close finds no app id and does nothing
  const clearTimer = () => {
    // Stryker disable next-line ConditionalExpression: equivalent, clearTimeout(null) does nothing, and a stray refresh finds no app id
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const schedule = (ms: number, gen: number) => {
    clearTimer();
    timer = backgroundTimeout(() => void ask(gen), Math.max(0, ms));
  };

  async function ask(gen: number) {
    const id = appId;
    // Stryker disable next-line ConditionalExpression: equivalent, close clears the timer, so ask always runs with an app id
    if (!id) return;
    try {
      const grant = await opts.fetchToken(id);
      if (gen !== generation) return;
      set({ status: "ready", profile: { ...grant.profile, token: grant.token } });
      schedule(grant.expiresAt - REFRESH_MARGIN_MS - Date.now(), gen);
    } catch (err) {
      failed(err, id, gen);
    }
  }

  /** A failed refresh is retried; a first ask that fails leaves no profile, and says why. */
  function failed(err: unknown, id: string, gen: number) {
    if (gen !== generation) return;
    if (state.status === "ready") return schedule(RETRY_MS, gen);
    if (err instanceof OgsApiError && err.code === "game_not_found") console.info(notListed(id));
    else console.warn("[ogs] no game token for", id, err);
    set(NONE);
  }

  const close = () => {
    // Stryker disable next-line UpdateOperator: equivalent, counting down also gives every open its own number
    generation++;
    appId = null;
    clearTimer();
    if (state.status !== "none") set(NONE);
  };

  const store: Store<ProfileBridgeState, ProfileEvents> = {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // The page can't ask for anything: the app refreshes on its own schedule.
    dispatch: () => {},
    reset: close,
    on: () => () => {},
  };

  return {
    store,
    /** The game screen shows `next` (null: a page OGS can't name). */
    open(next: string | null) {
      // Stryker disable next-line ConditionalExpression: equivalent, with no app open, close changes nothing
      if (next !== null && next === appId) return;
      close();
      if (next === null) return;
      appId = next;
      set({ status: "asking" });
      void ask(generation);
    },
    close,
  };
}
