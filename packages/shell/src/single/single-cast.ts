import type { Store } from "@open-game-system/app-bridge-types";
import { z } from "zod";
import {
  type CastCommands,
  createCastStore,
  type NativeCastEvents,
  type NativeCastState,
} from "../cast-store";
import type { ShellRequest } from "./api-client";
import { castLauncherUrl } from "./cast-launcher-url";
import type { ShellIdentity } from "./identity";

/**
 * Cast from a single-game app: the receiver shows the OGS launcher as the OGS app does, with
 * `chrome=none&app=<appId>`, so the TV shows the game's manifest `tvUrl` full screen. Before the
 * game's cast button opens the picker or starts a session, the shell gets a launcher token
 * (POST /api/v1/sessions, as the OGS app's TV tab does) and sets the view. The game's own
 * SET_VIEW_URL is not used: the launcher shows the manifest's `tvUrl`.
 */
const SessionCreatedSchema = z.object({ sessionId: z.string().min(1), token: z.string().min(1) });

export interface SingleGameCastOptions {
  appId: string;
  apiBase: string;
  /** The OGS TV launcher, e.g. https://ogs-tv.pages.dev */
  tvBase: string;
  request: ShellRequest;
  getIdentity: () => ShellIdentity | null;
  commands?: CastCommands;
  /** The couch session's TV name (default "TV"). */
  tvName?: string;
}

export function createSingleGameCastStore(
  opts: SingleGameCastOptions,
): Store<NativeCastState, NativeCastEvents> {
  const inner = createCastStore(opts.commands);
  let preparing: Promise<void> | null = null;

  async function makeView(): Promise<void> {
    const identity = opts.getIdentity();
    if (!identity) return;
    const created = await opts.request(SessionCreatedSchema, "/api/v1/sessions", {
      method: "POST",
      body: { tvName: opts.tvName ?? "TV" },
      token: identity.deviceToken,
    });
    const launcher = `${opts.tvBase.replace(/\/+$/, "")}/?api=${encodeURIComponent(
      opts.apiBase,
    )}&token=${encodeURIComponent(created.token)}`;
    inner.dispatch({ type: "SET_VIEW_URL", url: castLauncherUrl(launcher, opts.appId) });
  }

  /** The launcher view, once (a failed attempt is tried again on the next cast). */
  function prepare(): Promise<void> {
    if (inner.getSnapshot().viewUrl) return Promise.resolve();
    preparing ??= makeView()
      .catch((err: unknown) => console.warn("[ogs-shell] no launcher token for the cast:", err))
      .finally(() => {
        preparing = null;
      });
    return preparing;
  }

  return {
    getSnapshot: () => inner.getSnapshot(),
    subscribe: (listener) => inner.subscribe(listener),
    reset: () => inner.reset(),
    on: (type, listener) => inner.on(type, listener),
    dispatch(event) {
      if (event.type === "SET_VIEW_URL") return;
      if (event.type === "START_CASTING" || event.type === "SHOW_CAST_PICKER") {
        void prepare().then(() => inner.dispatch(event));
        return;
      }
      inner.dispatch(event);
    },
  };
}
