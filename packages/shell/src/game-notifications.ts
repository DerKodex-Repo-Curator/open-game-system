import type { Store } from "@open-game-system/app-bridge-types";
import {
  NotificationsBridgeEventSchema,
  type NotificationsBridgeState,
  type OgsNotification,
  type PushConsentResult,
} from "@open-game-system/ogs-protocol";
import type { UntrustedEvent } from "./ogs-bridge";

export type NotificationsStores = {
  notifications: { state: NotificationsBridgeState; events: UntrustedEvent };
};

export interface GameNotificationsDeps {
  /** The game open in the WebView. */
  appId: () => string | null;
  gameName: () => string;
  /** A kid's iPad (a tablet): OGS never pushes to a kid, so the page is told no without asking. */
  isKidDevice: () => boolean;
  /** The player already allowed this game (Settings lists it): answer without the sheet. */
  alreadyAllowed: (appId: string) => Promise<boolean>;
  /** The app's own sheet: "Let <game> notify you?" → Allow (true) or Not now (false). */
  askPlayer: (gameName: string) => Promise<boolean>;
  /** The OS permission for OGS's notifications (asked once by the OS). */
  osPermission: () => Promise<boolean>;
  /** POST /games/:appId/push-handles. */
  optIn: (appId: string, join?: string) => Promise<PushConsentResult>;
}

const EMPTY: NotificationsBridgeState = { answer: null, last: null };
const DENIED: PushConsentResult = { status: "denied" };

/**
 * The game WebView's `notifications` bridge store (spec §9). The page asks with REQUEST: the app
 * shows its sheet, checks the OS permission, opts in with OGS and answers by the request's id. The
 * page says LISTENING when it handles pushes itself; `deliver` hands it one swallowed while open.
 */
export function createGameNotifications(deps: GameNotificationsDeps) {
  let state = EMPTY;
  let listening = false;
  let seq = 0;
  const listeners = new Set<(s: NotificationsBridgeState) => void>();
  const set = (next: NotificationsBridgeState) => {
    state = next;
    for (const l of listeners) l(state);
  };

  async function consent(join?: string): Promise<PushConsentResult> {
    const appId = deps.appId();
    if (!appId || deps.isKidDevice()) return DENIED;
    const allowed = await deps.alreadyAllowed(appId).catch(() => false);
    if (!allowed && !(await deps.askPlayer(deps.gameName()))) return DENIED;
    if (!(await deps.osPermission())) return DENIED;
    try {
      return await deps.optIn(appId, join);
    } catch (err) {
      console.warn("[notifications] could not opt in with OGS:", err);
      return DENIED;
    }
  }

  const store: Store<NotificationsBridgeState, UntrustedEvent> = {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      listening = false;
      set(EMPTY);
    },
    on: () => () => {},
    dispatch(event) {
      const parsed = NotificationsBridgeEventSchema.safeParse(event);
      if (!parsed.success) return;
      const e = parsed.data;
      if (e.type === "LISTENING") {
        listening = e.on;
        return;
      }
      void consent(e.handle).then((result) => set({ ...state, answer: { id: e.id, result } }));
    },
  };

  return {
    store,
    listening: () => listening,
    deliver(notification: OgsNotification) {
      seq += 1;
      set({ ...state, last: { seq, notification } });
    },
  };
}
