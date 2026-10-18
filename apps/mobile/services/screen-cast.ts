import { z } from "zod";
import type { CastBackend } from "./cast-backend";
import type { CastDevice } from "./cast-store";
import type { SessionManagerLike } from "./cast-sync";

/**
 * Browser TVs (2026-10-17-browser-tv.feature; ADR 2026-10-17-browser-screens): a browser on the TV
 * shows a code, this phone claims it once, and it is then one of this phone's TVs next to its
 * Chromecasts. A cast sends it the launcher token LOAD_VIEW carries (through the API); the browser
 * runs the launcher itself.
 */

/** The API calls a browser TV needs (services/ogs-api.ts). */
export type ScreensApi = {
  claim(code: string): Promise<{ screenId: string; name: string }>;
  show(screenId: string, token: string): Promise<void>;
  stop(screenId: string): Promise<void>;
};

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

const STORAGE_KEY = "ogs.browserTvs";
const SavedSchema = z.array(z.object({ screenId: z.string(), name: z.string() }));
type Saved = z.infer<typeof SavedSchema>;

const PREFIX = "screen:";
const deviceOf = (s: Saved[number]): CastDevice => ({
  id: `${PREFIX}${s.screenId}`,
  name: s.name,
  type: "browser",
});

type Session = NonNullable<Awaited<ReturnType<SessionManagerLike["getCurrentCastSession"]>>>;
type Handler<A extends unknown[]> = (...args: A) => void;
type Message = Record<string, unknown> | string;

const LoadViewSchema = z.object({ type: z.literal("LOAD_VIEW"), viewUrl: z.string().url() });

/** The launcher token a LOAD_VIEW's view URL carries (`?token=`), or null for any other message. */
function launcherTokenOf(message: Message): string | null {
  let data: unknown = message;
  if (typeof message === "string") {
    try {
      data = JSON.parse(message);
    } catch {
      return null;
    }
  }
  const load = LoadViewSchema.safeParse(data);
  return load.success ? new URL(load.data.viewUrl).searchParams.get("token") : null;
}

const ErrorWithCode = z.object({ code: z.string() });

export type AddScreenResult = { ok: true; device: CastDevice } | { ok: false; message: string };

export function createScreenCastBackend(deps: { api: ScreensApi; storage: Storage }) {
  let saved: Saved = [];
  // One array per change: the cast prompt reads it with useSyncExternalStore.
  let devices: CastDevice[] = [];
  const deviceListeners = new Set<(d: CastDevice[]) => void>();
  const publish = () => {
    devices = saved.map(deviceOf);
    for (const l of deviceListeners) l(devices);
  };
  const ready = deps.storage.getItem(STORAGE_KEY).then((raw) => {
    try {
      const parsed = SavedSchema.safeParse(JSON.parse(raw ?? "[]"));
      if (parsed.success && saved.length === 0) saved = parsed.data;
    } catch {}
    publish();
  });

  let current: { session: Session; screenId: string } | null = null;
  const handlers = {
    starting: new Set<Handler<[]>>(),
    started: new Set<Handler<[Session]>>(),
    startFailed: new Set<Handler<[Session, string]>>(),
    suspended: new Set<Handler<[]>>(),
    resumed: new Set<Handler<[Session]>>(),
    ending: new Set<Handler<[]>>(),
    ended: new Set<Handler<[]>>(),
  };
  const on = <A extends unknown[]>(set: Set<Handler<A>>, fn: Handler<A>) => {
    set.add(fn);
    return { remove: () => void set.delete(fn) };
  };

  function makeSession(screen: Saved[number]): Session {
    return {
      getCastDevice: async () => ({ deviceId: deviceOf(screen).id, friendlyName: screen.name }),
      addChannel: async () => ({
        async sendMessage(message: Message) {
          const token = launcherTokenOf(message);
          if (token) await deps.api.show(screen.screenId, token);
        },
        onMessage() {},
      }),
    };
  }

  const sessionManager: SessionManagerLike = {
    getCurrentCastSession: async () => current?.session ?? null,
    async startSession(deviceId: string) {
      const screen = saved.find((s) => deviceOf(s).id === deviceId);
      if (!screen) return false;
      for (const h of handlers.starting) h();
      const session = makeSession(screen);
      current = { session, screenId: screen.screenId };
      for (const h of handlers.started) h(session);
      return true;
    },
    async endCurrentSession() {
      const ending = current;
      if (!ending) return;
      for (const h of handlers.ending) h();
      current = null;
      try {
        await deps.api.stop(ending.screenId);
      } finally {
        for (const h of handlers.ended) h();
      }
    },
    onSessionStarting: (fn) => on(handlers.starting, fn),
    onSessionStarted: (fn) => on(handlers.started, fn),
    onSessionStartFailed: (fn) => on(handlers.startFailed, fn),
    onSessionSuspended: (fn) => on(handlers.suspended, fn),
    onSessionResumed: (fn) => on(handlers.resumed, fn),
    onSessionEnding: (fn) => on(handlers.ending, fn),
    onSessionEnded: (fn) => on(handlers.ended, fn),
  };

  return {
    ready,
    sessionManager,
    startDiscovery: publish,
    getDevices: () => devices,
    subscribeDevices(listener: (d: CastDevice[]) => void) {
      deviceListeners.add(listener);
      return () => {
        deviceListeners.delete(listener);
      };
    },
    showCastDialog() {},
    /** The code the browser TV shows, typed on this phone: it becomes one of this phone's TVs. */
    async addScreen(code: string): Promise<AddScreenResult> {
      try {
        const claimed = await deps.api.claim(code);
        saved = [...saved.filter((s) => s.screenId !== claimed.screenId), claimed];
        await deps.storage.setItem(STORAGE_KEY, JSON.stringify(saved));
        publish();
        return { ok: true, device: deviceOf(claimed) };
      } catch (err) {
        const coded = ErrorWithCode.safeParse(err);
        return {
          ok: false,
          message:
            coded.success && coded.data.code === "screen_not_found"
              ? "No TV shows that code. Check the code on the TV."
              : "Couldn't reach OGS. Check your connection and try again.",
        };
      }
    },
  };
}

/**
 * Two cast backends as one: the phone's Chromecasts and its browser TVs in one list, each session
 * started and ended on the side that has its TV. Events from both reach the app.
 */
export function combineCastBackends(primary: CastBackend, screens: CastBackend): CastBackend {
  let active: CastBackend | null = null;
  // The same array until either side's list changes (useSyncExternalStore reads it).
  let last: { a: CastDevice[]; b: CastDevice[]; all: CastDevice[] } | null = null;
  const getDevices = () => {
    const a = primary.getDevices();
    const b = screens.getDevices();
    if (last?.a !== a || last.b !== b) last = { a, b, all: [...a, ...b] };
    return last.all;
  };
  const owner = (deviceId: string) =>
    screens.getDevices().some((d) => d.id === deviceId) ? screens : primary;
  const both = <A extends unknown[]>(
    pick: (sm: SessionManagerLike) => (fn: Handler<A>) => { remove(): void },
    fn: Handler<A>,
  ) => {
    const subs = [pick(primary.sessionManager)(fn), pick(screens.sessionManager)(fn)];
    return { remove: () => subs.forEach((s) => s.remove()) };
  };

  const sessionManager: SessionManagerLike = {
    async getCurrentCastSession() {
      return (
        (await screens.sessionManager.getCurrentCastSession()) ??
        (await primary.sessionManager.getCurrentCastSession())
      );
    },
    async startSession(deviceId) {
      const side = owner(deviceId);
      const started = await side.sessionManager.startSession(deviceId);
      if (started) active = side;
      return started;
    },
    async endCurrentSession(stopCasting) {
      const side =
        active ?? ((await screens.sessionManager.getCurrentCastSession()) ? screens : primary);
      await side.sessionManager.endCurrentSession(stopCasting);
      if (side === active) active = null;
    },
    onSessionStarting: (fn) => both((sm) => sm.onSessionStarting.bind(sm), fn),
    onSessionStarted: (fn) => both((sm) => sm.onSessionStarted.bind(sm), fn),
    onSessionStartFailed: (fn) => both((sm) => sm.onSessionStartFailed.bind(sm), fn),
    onSessionSuspended: (fn) => both((sm) => sm.onSessionSuspended.bind(sm), fn),
    onSessionResumed: (fn) => both((sm) => sm.onSessionResumed.bind(sm), fn),
    onSessionEnding: (fn) =>
      both(
        (sm) => (sm.onSessionEnding ? sm.onSessionEnding.bind(sm) : () => ({ remove() {} })),
        fn,
      ),
    onSessionEnded: (fn) => both((sm) => sm.onSessionEnded.bind(sm), fn),
  };

  return {
    sessionManager,
    startDiscovery() {
      primary.startDiscovery();
      screens.startDiscovery();
    },
    getDevices,
    subscribeDevices(listener) {
      const all = () => listener(getDevices());
      const offs = [primary.subscribeDevices(all), screens.subscribeDevices(all)];
      return () => offs.forEach((off) => off());
    },
    showCastDialog: () => primary.showCastDialog(),
  };
}
