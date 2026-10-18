import type { CastBackend } from "../cast-backend";
import { castCommands, startCastSync } from "../cast-sync";
import type { ShellContext } from "./shell-runtime";
import { createSingleGameCastStore } from "./single-cast";

/** The production OGS TV launcher (apps/mobile eas.json, production profile). */
export const DEFAULT_TV_BASE = "https://ogs-tv.pages.dev";

/**
 * The game's `cast` bridge store for a single-game app, on a Cast backend (Google Cast on a
 * device, the fake Chromecast in tests): devices are discovered, the game's cast button drives the
 * session, and the receiver shows the launcher with chrome=none for this app.
 */
export function castGameStores(backend: CastBackend, opts: { streamServerUrl: string }) {
  return (ctx: ShellContext) => {
    const commands = castCommands(() => backend.showCastDialog());
    const cast = createSingleGameCastStore({
      appId: ctx.config.appId,
      apiBase: ctx.config.apiBase,
      tvBase: ctx.config.tvBase ?? DEFAULT_TV_BASE,
      request: ctx.request,
      getIdentity: ctx.getIdentity,
      commands,
    });
    backend.subscribeDevices((devices) => cast.dispatch({ type: "DEVICES_UPDATED", devices }));
    backend.startDiscovery();
    startCastSync(cast, backend.sessionManager, commands, opts.streamServerUrl);
    return { cast };
  };
}
