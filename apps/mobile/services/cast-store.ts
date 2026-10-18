import { createStore } from "@open-game-system/app-bridge-native";
import type { Producer, State, Store } from "@open-game-system/app-bridge-types";
import GoogleCast from "react-native-google-cast";

/**
 * Native cast store state — aligned with @open-game-system/cast-kit-core CastState.
 *
 * This is the native-side source of truth for casting state.
 * It syncs to web games via app-bridge.
 */
export interface CastDevice {
  id: string;
  name: string;
  type: "chromecast" | "airplay" | "browser";
}

export interface CastSession {
  status: "disconnected" | "connecting" | "connected";
  deviceId: string | null;
  deviceName: string | null;
  sessionId: string | null;
  streamSessionId: string | null;
}

export interface NativeCastState extends State {
  isAvailable: boolean;
  devices: CastDevice[];
  session: CastSession;
  error: string | null;
  /** The page the game wants on the TV; sent to the receiver when a cast session starts. */
  viewUrl: string | null;
}

/**
 * Events the cast store handles.
 *
 * Some are dispatched from the native side (DEVICES_UPDATED, SESSION_CONNECTED),
 * some from the web side via app-bridge (START_CASTING, STOP_CASTING, SHOW_CAST_PICKER).
 */
export type NativeCastEvents =
  | { type: "DEVICES_UPDATED"; devices: CastDevice[] }
  | { type: "START_CASTING"; deviceId: string }
  | { type: "STOP_CASTING" }
  // Native-only: Google Cast's own session lifecycle (distinct from the game's START/STOP commands,
  // so a session ending by itself never triggers another stop).
  | { type: "SESSION_STARTING" }
  | { type: "SESSION_ENDED" }
  | {
      type: "SESSION_CONNECTED";
      deviceId: string;
      deviceName: string;
      sessionId: string;
      streamSessionId: string;
    }
  | { type: "SET_ERROR"; error: string }
  | { type: "RESET_ERROR" }
  | { type: "SCAN_DEVICES" }
  | { type: "SHOW_CAST_PICKER" }
  | { type: "SEND_STATE_UPDATE"; payload: unknown }
  | { type: "SET_VIEW_URL"; url: string };

export type CastStores = {
  cast: {
    state: NativeCastState;
    events: NativeCastEvents;
  };
};

export const CAST_INITIAL_STATE: NativeCastState = {
  isAvailable: false,
  devices: [],
  session: {
    status: "disconnected",
    deviceId: null,
    deviceName: null,
    sessionId: null,
    streamSessionId: null,
  },
  error: null,
  viewUrl: null,
};

type CastEventOf<K extends NativeCastEvents["type"]> = Extract<NativeCastEvents, { type: K }>;
type CastHandlers = {
  [K in NativeCastEvents["type"]]: (draft: NativeCastState, event: CastEventOf<K>) => void;
};

/** Sets the whole session (and clears the error): every lifecycle step names all of it. */
function setSession(draft: NativeCastState, session: CastSession): void {
  draft.session = session;
  draft.error = null;
}

const DISCONNECTED: CastSession = CAST_INITIAL_STATE.session;
const noStateChange = () => {
  // Side-effect or forwarded events.
};

const CAST_HANDLERS: CastHandlers = {
  DEVICES_UPDATED: (draft, event) => {
    draft.devices = event.devices;
    draft.isAvailable = event.devices.length > 0;
  },
  START_CASTING: (draft, event) =>
    setSession(draft, { ...DISCONNECTED, status: "connecting", deviceId: event.deviceId }),
  SESSION_CONNECTED: (draft, { deviceId, deviceName, sessionId, streamSessionId }) =>
    setSession(draft, { status: "connected", deviceId, deviceName, sessionId, streamSessionId }),
  SESSION_STARTING: (draft) => {
    draft.session.status = "connecting";
    draft.error = null;
  },
  STOP_CASTING: (draft) => setSession(draft, { ...DISCONNECTED }),
  SESSION_ENDED: (draft) => setSession(draft, { ...DISCONNECTED }),
  SET_ERROR: (draft, event) => {
    draft.error = event.error;
  },
  RESET_ERROR: (draft) => {
    draft.error = null;
  },
  SET_VIEW_URL: (draft, event) => {
    draft.viewUrl = event.url;
  },
  SCAN_DEVICES: noStateChange,
  SHOW_CAST_PICKER: noStateChange,
  SEND_STATE_UPDATE: noStateChange,
};

function applyCastEvent<K extends NativeCastEvents["type"]>(
  type: K,
  draft: NativeCastState,
  event: CastEventOf<K>,
): void {
  const handler: CastHandlers[K] = CAST_HANDLERS[type];
  handler(draft, event);
}

const castProducer: Producer<NativeCastState, NativeCastEvents> = (draft, event) =>
  applyCastEvent(event.type, draft, event);

/** What the game's START_CASTING / STOP_CASTING commands do natively (see cast-sync.ts). */
export type CastCommands = {
  startCasting(deviceId: string, devices: CastDevice[]): void;
  stopCasting(): void;
};

/**
 * Creates the native cast store instance.
 * Side effects: SHOW_CAST_PICKER opens the native Cast dialog; START/STOP_CASTING from the game
 * run the given commands against the real Google Cast session.
 */
export function createCastStore(commands?: CastCommands): Store<NativeCastState, NativeCastEvents> {
  return createStore<NativeCastState, NativeCastEvents>({
    initialState: CAST_INITIAL_STATE,
    producer: castProducer,
    on: {
      SHOW_CAST_PICKER: () => {
        GoogleCast.showCastDialog();
      },
      START_CASTING: (event, store) => {
        commands?.startCasting(event.deviceId, store.getSnapshot().devices);
      },
      STOP_CASTING: () => {
        commands?.stopCasting();
      },
    },
  });
}
