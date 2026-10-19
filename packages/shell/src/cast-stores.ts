import type { CastBackend } from "./cast-backend";
import { castCommands, startCastSync } from "./cast-sync";
import { combineCastBackends, createScreenCastBackend } from "./screen-cast";
import { createShellScreensApi } from "./screens-api";
import type { ShellContext } from "./shell-runtime";
import { createSingleGameCastStore } from "./single-cast";

/** The production OGS TV launcher (apps/mobile eas.json, production profile). */
export const DEFAULT_TV_BASE = "https://ogs-tv.pages.dev";

/** Where this phone keeps its paired browser TVs (AsyncStorage on a device). */
export type BrowserTvStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

/** A launcher base's host ("ogs-tv.pages.dev"): what the player types on the TV's browser. */
export function tvAddress(tvBase: string): string {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(tvBase);
  return m?.[1] ?? tvBase;
}

/** In memory: browser TVs paired this run only (tests, and apps that pass no storage). */
function memoryStorage(): BrowserTvStorage {
  const data = new Map<string, string>();
  return {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
  };
}

/**
 * The game's `cast` bridge store for a single-game app, on a Cast backend (Google Cast on a
 * device, the fake Chromecast in tests) plus the phone's browser TVs: casting is always available,
 * the game's cast button opens the shell's picker (Chromecasts + "Use a browser TV"), the session
 * follows the TV picked, and the receiver shows the launcher with chrome=none for this app.
 */
export function castGameStores(
  backend: CastBackend,
  opts: { streamServerUrl: string; browserTvStorage?: BrowserTvStorage },
) {
  return (ctx: ShellContext) => {
    const browserTvs = createScreenCastBackend({
      api: createShellScreensApi({ request: ctx.request, getIdentity: ctx.getIdentity }),
      storage: opts.browserTvStorage ?? memoryStorage(),
    });
    const tvs = combineCastBackends(backend, browserTvs);
    const openPicker = () => ctx.castPicker.open();
    const commands = castCommands(openPicker);
    const tvBase = ctx.config.tvBase ?? DEFAULT_TV_BASE;
    const cast = createSingleGameCastStore({
      appId: ctx.config.appId,
      apiBase: ctx.config.apiBase,
      tvBase,
      request: ctx.request,
      getIdentity: ctx.getIdentity,
      commands,
      showPicker: openPicker,
    });
    tvs.subscribeDevices((devices) => cast.dispatch({ type: "DEVICES_UPDATED", devices }));
    const detach = ctx.castPicker.attach({
      getDevices: () => tvs.getDevices(),
      subscribeDevices: (listener) => tvs.subscribeDevices(listener),
      cast: (deviceId) => cast.dispatch({ type: "START_CASTING", deviceId }),
      addBrowserTv: (code) => browserTvs.addScreen(code),
      tvAddress: tvAddress(tvBase),
    });
    ctx.onStop(detach);
    tvs.startDiscovery();
    startCastSync(cast, tvs.sessionManager, commands, opts.streamServerUrl);
    return { cast };
  };
}
