import type { CastBackend } from "./cast-backend";
import type { CastDevice } from "./cast-store";
import type { SessionManagerLike } from "./cast-sync";

/**
 * A Google Cast stand-in for the iOS simulator (EXPO_PUBLIC_FAKE_CAST). It sits behind the same
 * interfaces as the real one (SessionManagerLike, ViewChannelSession), so cast-sync, the TV tab
 * and the game screen run unchanged. The "receiver" is the fake Chromecast the main loop runs:
 * LOAD_VIEW becomes POST { viewUrl } to its control URL, where a browser opens the launcher;
 * ending the session becomes POST /stop on the same origin, which closes it.
 */

export const FAKE_TV: CastDevice = {
  id: "fake-living-room",
  name: "Living room TV",
  type: "chromecast",
};

/** A second TV (EXPO_PUBLIC_FAKE_CAST=2), found a moment after the first, as real discovery does. */
export const FAKE_TV_2: CastDevice = {
  id: "fake-bedroom",
  name: "Bedroom TV",
  type: "chromecast",
};
export const FAKE_TV_2_DELAY_MS = 1500;

type FakeCastOptions = {
  endedAfterMs?: number;
  loadUrls?: Record<string, string>;
  refuseWhileActive?: boolean;
};

/**
 * The fake's timing and TVs from the build's env: EXPO_PUBLIC_FAKE_CAST_END_MS (Cast's real end
 * timing, see endedAfterMs), EXPO_PUBLIC_FAKE_CAST_URL_2 (the Bedroom TV's own fake Chromecast)
 * and EXPO_PUBLIC_FAKE_CAST_REFUSE_ACTIVE=1 (see refuseWhileActive).
 */
export function fakeCastOptions(env: {
  EXPO_PUBLIC_FAKE_CAST_END_MS?: string;
  EXPO_PUBLIC_FAKE_CAST_URL_2?: string;
  EXPO_PUBLIC_FAKE_CAST_REFUSE_ACTIVE?: string;
}): FakeCastOptions {
  const out: FakeCastOptions = {};
  const ms = Number(env.EXPO_PUBLIC_FAKE_CAST_END_MS);
  if (env.EXPO_PUBLIC_FAKE_CAST_END_MS && Number.isFinite(ms) && ms >= 0) out.endedAfterMs = ms;
  if (env.EXPO_PUBLIC_FAKE_CAST_URL_2)
    out.loadUrls = { [FAKE_TV_2.id]: env.EXPO_PUBLIC_FAKE_CAST_URL_2 };
  if (env.EXPO_PUBLIC_FAKE_CAST_REFUSE_ACTIVE === "1") out.refuseWhileActive = true;
  return out;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type Message = Record<string, unknown> | string;
type Handler<A extends unknown[]> = (...args: A) => void;

export function createFakeCastBackend(opts: {
  mode: "one" | "two" | "none";
  loadUrl: string;
  fetch: FetchLike;
  /** A fake Chromecast of its own per TV (its /load URL); others use loadUrl. */
  loadUrls?: Record<string, string>;
  /**
   * Real Google Cast timing (EXPO_PUBLIC_FAKE_CAST_END_MS). endCurrentSession resolves as soon as
   * the end is asked for (the native bridge resolves right after endSessionAndStopCasting:), the
   * session stays current while it ends, and ended fires once the TV has stopped plus this many
   * ms. Meanwhile startSession resolves false, as GCKSessionManager's startSessionWithDevice:
   * answers NO "if there is a session currently established". Unset: ends at once (older runs).
   */
  endedAfterMs?: number;
  /**
   * startSession resolves false while a session is up (connected or ending), for any TV, as
   * GCKSessionManager does, without the end timing (endedAfterMs implies it). Unset: a start
   * replaces the running session (older runs).
   */
  refuseWhileActive?: boolean;
}): CastBackend {
  const devices =
    opts.mode === "none" ? [] : opts.mode === "two" ? [FAKE_TV, FAKE_TV_2] : [FAKE_TV];
  let discovered: CastDevice[] = [];
  let trickle: ReturnType<typeof setTimeout> | null = null;
  const deviceListeners = new Set<(d: CastDevice[]) => void>();

  type Session = ReturnType<typeof makeSession>;
  let current: Session | null = null;
  let currentDevice: CastDevice | null = null;
  let ending = false;
  const realTiming = opts.endedAfterMs !== undefined;
  const refuseWhileActive = realTiming || opts.refuseWhileActive === true;
  const loadUrlFor = (device: CastDevice) => opts.loadUrls?.[device.id] ?? opts.loadUrl;
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

  function makeSession(device: CastDevice) {
    return {
      getCastDevice: async () => ({ deviceId: device.id, friendlyName: device.name }),
      addChannel: async (_namespace: string) => ({
        async sendMessage(message: Message) {
          const data = typeof message === "string" ? JSON.parse(message) : message;
          if (data?.type !== "LOAD_VIEW") return;
          try {
            await opts.fetch(loadUrlFor(device), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ viewUrl: data.viewUrl }),
            });
          } catch (err) {
            console.warn("[fake-cast] the fake Chromecast did not take the view:", err);
          }
        },
        onMessage(_listener: (message: Message) => void) {},
      }),
    };
  }

  const sessionManager: SessionManagerLike = {
    getCurrentCastSession: async () => current,
    async startSession(deviceId: string) {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) return false;
      // Real Cast: NO while a session is established (connected, or still ending).
      if (refuseWhileActive && current) return false;
      for (const h of handlers.starting) h();
      const session = makeSession(device);
      current = session;
      currentDevice = device;
      for (const h of handlers.started) h(session);
      return true;
    },
    async endCurrentSession() {
      if (!current || !currentDevice || ending) return;
      const device = currentDevice;
      for (const h of handlers.ending) h();
      const finish = () => {
        current = null;
        currentDevice = null;
        ending = false;
        for (const h of handlers.ended) h();
      };
      if (!realTiming) {
        current = null;
        await stopTv(device);
        return finish();
      }
      ending = true;
      void stopTv(device).then(() => setTimeout(finish, opts.endedAfterMs));
    },
    onSessionStarting: (fn) => on(handlers.starting, fn),
    onSessionStarted: (fn) => on(handlers.started, fn),
    onSessionStartFailed: (fn) => on(handlers.startFailed, fn),
    onSessionSuspended: (fn) => on(handlers.suspended, fn),
    onSessionResumed: (fn) => on(handlers.resumed, fn),
    onSessionEnding: (fn) => on(handlers.ending, fn),
    onSessionEnded: (fn) => on(handlers.ended, fn),
  };

  /** A real receiver closes when the sender stops casting: the fake Chromecast closes its TV page. */
  async function stopTv(device: CastDevice) {
    try {
      await opts.fetch(new URL("/stop", loadUrlFor(device)).href, { method: "POST" });
    } catch (err) {
      console.warn("[fake-cast] the fake Chromecast did not stop:", err);
    }
  }

  return {
    sessionManager,
    startDiscovery() {
      const publish = (found: CastDevice[]) => {
        discovered = found;
        for (const l of deviceListeners) l(discovered);
      };
      if (devices.length < 2 || discovered.length === devices.length) return publish(devices);
      publish(devices.slice(0, 1));
      // A search while the second TV is on its way keeps its arrival (a restart would put it off).
      if (trickle) return;
      trickle = setTimeout(() => {
        trickle = null;
        publish(devices);
      }, FAKE_TV_2_DELAY_MS);
    },
    getDevices: () => discovered,
    subscribeDevices(listener) {
      deviceListeners.add(listener);
      return () => {
        deviceListeners.delete(listener);
      };
    },
    showCastDialog() {
      // The simulator has no native picker; the TV tab lists the fake device itself.
    },
  };
}
