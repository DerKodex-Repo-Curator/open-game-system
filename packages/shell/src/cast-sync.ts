import type { Store } from "@open-game-system/app-bridge-types";
import GoogleCast from "react-native-google-cast";
import { sessionConnectedEvent } from "./cast-session-device";
import type { CastCommands, CastDevice, NativeCastEvents, NativeCastState } from "./cast-store";
import { type CastTrace, noTrace } from "./cast-trace";
import { connectViewChannel, type ViewChannelSession } from "./cast-view";
import { hashId } from "./client-log";

type Subscription = { remove(): void };
type Session = ViewChannelSession & {
  getCastDevice(): Promise<{ deviceId: string; friendlyName: string } | null>;
};

/** The slice of react-native-google-cast's SessionManager this needs (keeps it testable). */
export type SessionManagerLike = {
  getCurrentCastSession(): Promise<Session | null>;
  startSession(deviceId: string): Promise<boolean>;
  endCurrentSession(stopCasting?: boolean): Promise<void>;
  onSessionStarting(handler: () => void): Subscription;
  onSessionStarted(handler: (session: Session) => void): Subscription;
  onSessionStartFailed(handler: (session: Session, error: string) => void): Subscription;
  onSessionSuspended(handler: () => void): Subscription;
  onSessionResumed(handler: (session: Session) => void): Subscription;
  /** The session is ending (GCK willEndCastSession); it stays current until ended. */
  onSessionEnding?(handler: () => void): Subscription;
  /** Ended (GCK didEndCastSession), with the error that ended it, if any. */
  onSessionEnded(handler: (session?: unknown, error?: string | null) => void): Subscription;
};

/**
 * The game's cast buttons, run against the real session. Created before the store (the store's
 * side effects call these) and bound to the SessionManager when sync starts.
 */
export function castCommands(
  showCastDialog: () => void = () => GoogleCast.showCastDialog(),
  trace: CastTrace = noTrace,
): CastCommands & { bind(sm: SessionManagerLike): void } {
  let sm: SessionManagerLike | null = null;
  return {
    bind(next) {
      sm = next;
    },
    startCasting(deviceId: string, devices: CastDevice[]) {
      if (sm && devices.some((d) => d.id === deviceId))
        void sm.startSession(deviceId).catch((err: unknown) => {
          trace.event("game_start.rejected", { error: err, data: { tv: hashId(deviceId) } });
          showCastDialog();
        });
      else showCastDialog();
    },
    stopCasting() {
      // true: also stop the receiver app on the TV, not just disconnect this phone.
      void sm
        ?.endCurrentSession(true)
        .catch((err: unknown) => trace.event("game_stop.rejected", { error: err }));
    },
  };
}

/**
 * Keeps the cast store in step with the real Google Cast session for the app's lifetime: picks up
 * a session that already exists, follows every lifecycle event (including failures and
 * suspensions), and keeps the receiver supplied with the game's TV page. Returns a teardown.
 */
export function startCastSync(
  store: Store<NativeCastState, NativeCastEvents>,
  sm: SessionManagerLike,
  commands: { bind(sm: SessionManagerLike): void },
  streamServerUrl: string,
  trace: CastTrace = noTrace,
  /** What LOAD_VIEW names besides the view (the couch session's id), for the receiver's logs. */
  viewContext: () => { sessionId?: string } = () => ({}),
): () => void {
  commands.bind(sm);
  let channel: { send(): Promise<void> } | null = null;
  let generation = 0;
  let stopped = false;

  const connected = (session: Session) => {
    // A lookup still in flight at teardown (the initial getCurrentCastSession) must change nothing.
    if (stopped) return;
    const mine = ++generation;
    channel = null;
    void connectViewChannel(
      session,
      () => store.getSnapshot().viewUrl,
      streamServerUrl,
      trace,
      viewContext,
    ).then((c) => {
      if (mine === generation) channel = c;
    });
    void session
      .getCastDevice()
      .catch(() => null)
      .then((device) => {
        trace.event("session.connected", {
          level: mine === generation ? "info" : "warn",
          data: {
            tv: device ? hashId(device.deviceId) : null,
            ...(mine === generation ? {} : { stale: true }),
          },
        });
        if (mine === generation)
          store.dispatch(sessionConnectedEvent(device, store.getSnapshot().devices));
      });
  };
  const ended = () => {
    generation++;
    channel = null;
    store.dispatch({ type: "SESSION_ENDED" });
  };

  const subs: Subscription[] = [
    sm.onSessionStarting(() => {
      trace.event("session.starting");
      store.dispatch({ type: "SESSION_STARTING" });
    }),
    sm.onSessionStarted((session) => {
      trace.event("session.started");
      connected(session);
    }),
    sm.onSessionResumed((session) => {
      trace.event("session.resumed");
      connected(session);
    }),
    sm.onSessionSuspended(() => {
      trace.event("session.suspended", { level: "warn" });
      store.dispatch({ type: "SESSION_STARTING" });
    }),
    sm.onSessionStartFailed((_session, error) => {
      trace.event("session.start_failed", { error });
      ended();
      store.dispatch({ type: "SET_ERROR", error: `Couldn't start casting: ${error}` });
    }),
    sm.onSessionEnded((_session, error) => {
      trace.event("session.ended", error ? { error, level: "warn" } : {});
      ended();
    }),
  ];
  if (sm.onSessionEnding) subs.push(sm.onSessionEnding(() => trace.event("session.ending")));

  // The game's TV page changed (e.g. a new room): tell the receiver.
  let lastViewUrl = store.getSnapshot().viewUrl;
  const unsubscribe = store.subscribe((state) => {
    if (state.viewUrl && state.viewUrl !== lastViewUrl) {
      lastViewUrl = state.viewUrl;
      void channel?.send();
    }
  });

  // A session may already be running (app reopened while casting).
  void sm
    .getCurrentCastSession()
    .then((session) => {
      if (!session) return;
      trace.event("session.found");
      connected(session);
    })
    .catch((err: unknown) => trace.event("session.lookup_failed", { error: err, level: "warn" }));

  return () => {
    stopped = true;
    generation++;
    subs.forEach((s) => s.remove());
    unsubscribe();
  };
}
