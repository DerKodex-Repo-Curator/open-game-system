import type { ClientMessage, FollowTarget, Manifest } from "@open-game-system/ogs-protocol";
import { playingView } from "@open-game-system/ogs-protocol";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { Platform, AppState as RNAppState } from "react-native";
import { createCastPrompt } from "../components/ogs/library/play-action";
import { createAppState } from "./app-state";
import type { CastBackend } from "./cast-backend";
import {
  type CastOutcome,
  castToTv,
  createGameCastStore,
  endForTonight,
  switchTv,
} from "./cast-flow";
import { createCastOnce } from "./cast-once";
import { createCastStop } from "./cast-stop";
import { createCastStore } from "./cast-store";
import { announceSwitch, createCastSwitch } from "./cast-switch";
import { castCommands, startCastSync } from "./cast-sync";
import { createCastTrace } from "./cast-trace";
import { streamServerUrl } from "./cast-view";
import {
  type ClientLogContext,
  clientEventsSender,
  createClientLog,
  hashId,
  type LogData,
} from "./client-log";
import { appConfig, isLauncherView } from "./config";
import { askToNotify } from "./consent-sheet";
import { followStep } from "./couch-follow";
import {
  type CouchSession,
  type CouchSnapshot,
  couchSocketUrl,
  createCouchSession,
  type SocketLike,
} from "./couch-session";
import { createFakeCastBackend, fakeCastOptions } from "./fake-cast";
import { isOgsCast } from "./game-cast-route";
import { createGameNotifications } from "./game-notifications";
import { createGamePresence } from "./game-presence";
import { createGameProfile, createGameTokenClient } from "./game-profile";
import { createGameUrls, rejoinUrl, rememberGame } from "./game-rejoin";
import { createGoogleCastBackend } from "./google-cast-backend";
import { createInviteAttribution } from "./invite-attribution";
import { captureJsErrors, type RejectionTracker } from "./js-errors";
import { createLastTv, rememberConnectedTv } from "./last-tv";
import { launchPlan } from "./launch-plan";
import type { ReturnPill } from "./leave-game";
import { createLinkHold } from "./link-routing";
import { pushPermissionGranted, setForegroundGate } from "./notifications";
import { createOgsApi } from "./ogs-api";
import { createPushApi } from "./push-api";
import { foregroundDecision } from "./push-foreground";
import { createRoomJoiner, roomStartUrl } from "./rooms";
import { combineCastBackends, createScreenCastBackend } from "./screen-cast";
import { sittingToOpen } from "./sittings";

/**
 * The app's singletons, wired once for its lifetime: config, cast backend (real or fake) and the
 * cast store kept in step with it, the OGS API, the app data store, and the couch session (open
 * while this device hosts or joined a cast). Screens read them through the hooks at the bottom.
 */

export const config = appConfig;

/** A link that opened the app before this phone had a profile waits here for onboarding. */
export const linkHold = createLinkHold();

const fetchImpl = (url: string, init?: RequestInit) => fetch(url, init);

// --- Client log (wide events → POST /api/v1/client-events → Workers Logs) -------------------

/** Who is logging: filled in once appState exists (below); events before that go without it. */
let logIdentity: () => Pick<ClientLogContext, "profileId" | "sessionId" | "deviceHash"> =
  () => ({});
let logAuth: () => { token: string } | null = () => null;
const appVersion = Constants.expoConfig?.version;
/** The native build number (EAS sets it at build time; null in development). */
const appBuild = Application.nativeBuildVersion;

export const clientLog = createClientLog({
  send: clientEventsSender({ baseUrl: config.apiBase, fetch: fetchImpl, auth: () => logAuth() }),
  context: () => ({
    app: "mobile",
    version: appVersion,
    build: `${appBuild ?? "dev"}${config.fakeCast === "off" ? "" : "+fake-cast"}`,
    platform: `${Platform.OS} ${Platform.Version}`,
    ...logIdentity(),
  }),
  now: Date.now,
  storage: AsyncStorage,
});
void clientLog.restore();
// Flush on background (and keep what couldn't be sent for the next launch).
RNAppState.addEventListener("change", (state) => {
  if (state === "background") void clientLog.background();
});

/**
 * Uncaught JS errors → the client log: RN's global handler, and unhandled promise rejections in
 * release builds (in dev, RN's LogBox owns Hermes' rejection tracker). The root layout's error
 * boundary reports through `jsErrors.boundary`.
 */
export const jsErrors = captureJsErrors(clientLog, {
  errorUtils: ErrorUtils,
  trackRejections: __DEV__ ? null : hermesRejectionTracker(),
});

/** Hermes' `enablePromiseRejectionTracker`, read off the untyped global (null without Hermes). */
function hermesRejectionTracker(): RejectionTracker | null {
  const hermes: unknown = Reflect.get(globalThis, "HermesInternal");
  if (typeof hermes !== "object" || hermes === null) return null;
  const enable: unknown = Reflect.get(hermes, "enablePromiseRejectionTracker");
  if (typeof enable !== "function") return null;
  return (options) => {
    Reflect.apply(enable, hermes, [options]);
  };
}

/** The cast lifecycle's log, one correlation id per cast attempt. */
export const castTrace = createCastTrace(clientLog);

const chromecasts: CastBackend =
  config.fakeCast === "off"
    ? createGoogleCastBackend(castTrace)
    : createFakeCastBackend({
        mode: config.fakeCast,
        loadUrl: config.fakeCastUrl,
        fetch: fetchImpl,
        ...fakeCastOptions({
          EXPO_PUBLIC_FAKE_CAST_END_MS: process.env.EXPO_PUBLIC_FAKE_CAST_END_MS,
          EXPO_PUBLIC_FAKE_CAST_URL_2: process.env.EXPO_PUBLIC_FAKE_CAST_URL_2,
          EXPO_PUBLIC_FAKE_CAST_REFUSE_ACTIVE: process.env.EXPO_PUBLIC_FAKE_CAST_REFUSE_ACTIVE,
        }),
      });

/**
 * Browser TVs (2026-10-17-browser-tv.feature): typed in by the code they show, then cast to like a
 * Chromecast. The API client is created below; these only call it once a phone casts.
 */
export const browserTvs = createScreenCastBackend({
  api: {
    claim: (code) => api.claimScreen(code),
    show: (screenId, token) => api.showOnScreen(screenId, token),
    stop: (screenId) => api.stopScreen(screenId),
  },
  storage: AsyncStorage,
});

export const castBackend: CastBackend = combineCastBackends(chromecasts, browserTvs);

const commands = castCommands(() => castBackend.showCastDialog(), castTrace);
export const castStore = createCastStore(commands);
/** Metro inlines EXPO_PUBLIC_* only for literal reads. */
const streamServer = streamServerUrl(
  { EXPO_PUBLIC_OGS_STREAM: process.env.EXPO_PUBLIC_OGS_STREAM },
  config.apiBase,
);
// LOAD_VIEW names the couch session, so the TV's log lines join the phone's (appState is defined
// below; this runs only once a session connects).
startCastSync(castStore, castBackend.sessionManager, commands, streamServer, castTrace, () => ({
  sessionId: appState.getSnapshot().session?.sessionId,
}));
castBackend.subscribeDevices((devices) => castStore.dispatch({ type: "DEVICES_UPDATED", devices }));

const auth = () => {
  const id = appState.getSnapshot().identity;
  return id ? { token: id.deviceToken } : null;
};

export const api = createOgsApi({ baseUrl: config.apiBase, fetch: fetchImpl, auth });

/** The game WebView's `profile` store: a token for the open game only (slice 3). */
export const gameProfile = createGameProfile({
  fetchToken: createGameTokenClient({
    baseUrl: config.apiBase,
    fetch: fetchImpl,
    auth,
    // The couch this phone is on, so a multiCouch game knows which household it sits with.
    sessionId: () => appState.getSnapshot().session?.sessionId ?? null,
  }),
});

/** App storage (wiped with the app), unlike the Keychain behind SecureStore. */
const INSTALLED_KEY = "@ogs/installed";

/** The invite another family this phone came through (2026-10-18-invite-another-family.feature). */
export const inviteAttribution = createInviteAttribution(AsyncStorage);

export const appState = createAppState({
  api,
  storage: SecureStore,
  invite: inviteAttribution,
  device: {
    kind: Device.deviceType === Device.DeviceType.TABLET ? "tablet" : "phone",
    name: Device.deviceName ?? "Phone",
  },
  newDeviceId: () => Crypto.randomUUID(),
  install: {
    isFirstLaunch: async () => (await AsyncStorage.getItem(INSTALLED_KEY)) !== "true",
    markLaunched: () => AsyncStorage.setItem(INSTALLED_KEY, "true"),
  },
});

logAuth = auth;
logIdentity = () => {
  const { identity: id, session } = appState.getSnapshot();
  return {
    profileId: id?.profile.id,
    sessionId: session?.sessionId,
    deviceHash: id ? hashId(id.deviceId) : undefined,
  };
};

// --- Couch session -------------------------------------------------------------------------

const CLOSED: CouchSnapshot = { status: "closed", state: null, remoteOffer: null, error: null };
let couch: CouchSession | null = null;
const couchListeners = new Set<() => void>();
const notifyCouch = () => {
  for (const l of couchListeners) l();
};

function webSocket(url: string): SocketLike {
  const ws = new WebSocket(url);
  const s: SocketLike = {
    get readyState() {
      return ws.readyState;
    },
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.onopen = () => s.onopen?.();
  ws.onmessage = (ev) => s.onmessage?.({ data: ev.data });
  ws.onclose = () => s.onclose?.();
  ws.onerror = () => s.onerror?.();
  return s;
}

export const couchHub = {
  getSnapshot: (): CouchSnapshot => couch?.getSnapshot() ?? CLOSED,
  subscribe(listener: () => void) {
    couchListeners.add(listener);
    return () => {
      couchListeners.delete(listener);
    };
  },
  send(msg: ClientMessage) {
    couch?.send(msg);
  },
  takeRemote: () => couch?.takeRemote(),
  dismissRemoteOffer: () => couch?.dismissRemoteOffer(),
};

let couchKey: string | null = null;

/** One couch socket per (profile token, session): opened on cast or join, closed on leave. */
function syncCouch() {
  const { identity: id, session } = appState.getSnapshot();
  const key = id && session ? `${id.deviceToken} ${session.sessionId}` : null;
  if (key === couchKey) return;
  couchKey = key;
  couch?.stop();
  couch = null;
  if (id && session) startCouch(id.deviceToken, id.deviceId, session.sessionId);
  notifyCouch();
}

function startCouch(token: string, deviceIdOfMine: string, sessionId: string) {
  couch = createCouchSession({
    url: couchSocketUrl(config.apiBase, token, sessionId),
    deviceId: deviceIdOfMine,
    createSocket: webSocket,
    // A game started from the TV with the remote: this phone hosts it, so open its start page.
    onFollowHost: ({ appId, instanceId, room }) => {
      const game = appState.getSnapshot().library.find((g) => g.appId === appId);
      // Continuing a paused game hosts its same room again, not a fresh one from the start page;
      // a sitting in another couch's room (spec §7) starts by joining that room.
      const start = (g: Manifest) => (room ? roomStartUrl(g.startUrl, room) : g.startUrl);
      if (game)
        gamePresence.followHost(appId, () =>
          pushGame(game, rejoinUrlFor(appId, instanceId) ?? start(game)),
        );
    },
    // Every couch phone follows the TV: into the game it plays (its room), back on Home.
    onFollowCouch: followTv,
  });
  couch.subscribe(notifyCouch);
  couch.start();
}
appState.subscribe(syncCouch);

// --- Derived state + actions ----------------------------------------------------------------

/** A game this app can open: one in the profile's library or the catalogue. */
function findGame(appId: string): Manifest | undefined {
  const { library, catalogue } = appState.getSnapshot();
  return [...library, ...catalogue].find((g) => g.appId === appId);
}

/** The couch session moved this phone (not the game's host) with the TV. */
function followTv(target: FollowTarget) {
  const game = target.kind === "game" ? findGame(target.appId) : undefined;
  const step = followStep(target, {
    manifest: game,
    openAppId: gamePresence.openApp(),
    current: couchHub.getSnapshot().state?.current ?? null,
    rejoinUrl: target.kind === "game" ? rejoinUrlFor(target.appId, target.instanceId) : undefined,
  });
  if (step.kind === "close") gamePresence.requestClose(step.appId);
  if (step.kind !== "open" || !game || target.kind !== "game") return;
  // A swap: leave the old game's screen (it remembers its page and pill) before opening the new.
  const open = gamePresence.openApp();
  if (step.replace && open) gamePresence.requestClose(open);
  pushGame(game, step.url, target.instanceId);
}

export function ogsCastNow(): boolean {
  const cast = castStore.getSnapshot();
  return isOgsCast({
    sessionCast: couchHub.getSnapshot().state?.cast,
    castConnected: cast.session.status === "connected",
    viewIsLauncher: isLauncherView(config, cast.viewUrl),
  });
}

/** Stop casting as the phone shows it: done at the confirm, not when the TV's reply comes back. */
export const castStop = createCastStop({ isCast: ogsCastNow });
castStore.subscribe(() => castStop.castChanged());
couchHub.subscribe(() => castStop.castChanged());

/** The TV this phone cast to last, kept across launches: the Cast button's TV after a restart. */
export const lastTv = createLastTv({ storage: AsyncStorage });
rememberConnectedTv(castStore, lastTv);

export const deviceId = () => appState.getSnapshot().identity?.deviceId ?? "this-phone";

export const gamePresence = createGamePresence();

/** Game pushes (spec §9): consent from the open game's page, and Settings. */
export const pushApi = createPushApi({ baseUrl: config.apiBase, fetch: fetchImpl, auth });
export const gameNotifications = createGameNotifications({
  appId: () => gamePresence.openApp(),
  gameName: () => {
    const open = gamePresence.openApp();
    return appState.getSnapshot().catalogue.find((g) => g.appId === open)?.name ?? "This game";
  },
  isKidDevice: () => Device.deviceType === Device.DeviceType.TABLET,
  alreadyAllowed: async (appId) => (await pushApi.grantedGames()).includes(appId),
  askPlayer: askToNotify,
  osPermission: pushPermissionGranted,
  optIn: (appId, join) => pushApi.optIn(appId, join),
});
// A push for the game on screen, whose page listens, goes to the page instead of a banner.
setForegroundGate((n) => {
  const { banner, toPage } = foregroundDecision(
    { data: n.request.content.data, title: n.request.content.title, body: n.request.content.body },
    { openAppId: gamePresence.openApp(), listening: gameNotifications.listening() },
  );
  if (toPage) gameNotifications.deliver(toPage);
  return banner;
});

/** Each game's latest page (its room), so Rejoin returns there instead of starting a new one. */
const gameUrls = createGameUrls();

/** The game screen is closing on `url` (the WebView's latest page): remember it for Rejoin. */
export function rememberGameUrl(appId: string, url: string) {
  gameUrls.record(rememberGame(appId, url, couchHub.getSnapshot().state));
}

function rejoinUrlFor(appId: string, instanceId?: string): string | undefined {
  return rejoinUrl(appId, {
    remembered: gameUrls.get(appId),
    session: couchHub.getSnapshot().state,
    pill: appState.getSnapshot().pill,
    instanceId,
  });
}

function pushGame(game: Pick<Manifest, "appId" | "name">, url: string, instanceId?: string) {
  gamePresence.opening(game.appId);
  router.push({
    pathname: "/game",
    params: { url, name: game.name, appId: game.appId, ...(instanceId ? { instanceId } : {}) },
  });
}

/**
 * A tap on a game (a game's page, Playing, the return pill): spec v3, Where a game plays.
 * `instanceId` names one sitting to rejoin (a game's page lists several).
 */
export function openGame(
  game: Manifest,
  opts: { mode?: "continue" | "new"; resumeUrl?: string; instanceId?: string } = {},
) {
  const isNew = opts.mode === "new";
  const resumeUrl =
    opts.resumeUrl ?? (isNew ? undefined : rejoinUrlFor(game.appId, opts.instanceId));
  const instanceId = isNew ? undefined : opts.instanceId;
  const live = couchHub.getSnapshot().state?.current;
  const plan = launchPlan({
    manifest: game,
    ogsCast: ogsCastNow(),
    deviceId: deviceId(),
    mode: opts.mode,
    resumeUrl,
    instanceId,
    // The game the TV is playing: join its room, never a new one (spec §7, §8).
    liveRoom: live?.appId === game.appId ? live.room : undefined,
  });
  const sitting = sittingToOpen(game.appId, { instanceId, resumeUrl }, Date.now());
  switch (plan.kind) {
    case "tv":
      couchHub.send(plan.start);
      pushGame(game, plan.url, sitting);
      break;
    case "phone":
      pushGame(game, plan.url, sitting);
      break;
    case "needs-tv":
      router.push({ pathname: "/library/[appId]", params: { appId: game.appId } });
      break;
  }
}

export function openPill(pill: ReturnPill) {
  const game = appState.getSnapshot().library.find((g) => g.appId === pill.appId);
  if (game) openGame(game, { resumeUrl: pill.url, instanceId: pill.instanceId });
  else router.push({ pathname: "/game", params: { url: pill.url, name: pill.name } });
}

/**
 * Several couches, one room (spec §7): an invite link or Join with your couch starts the game in
 * that room on this couch's TV, at once while cast, else as soon as the TV is cast.
 */
export const roomJoiner = createRoomJoiner({
  find: (appId) => {
    const { library, catalogue } = appState.getSnapshot();
    return [...library, ...catalogue].find((g) => g.appId === appId);
  },
  isCast: ogsCastNow,
  subscribeCast: (listener) => {
    const offCast = castStore.subscribe(listener);
    const offCouch = couchHub.subscribe(listener);
    return () => {
      offCast();
      offCouch();
    };
  },
  deviceId,
  send: (msg) => couchHub.send(msg),
  open: (game, url) => pushGame(game, url),
});

/** One Cast at a time: a second tap while one runs shares its outcome (cast-once.ts). */
const castOnce = createCastOnce<CastOutcome>();

/**
 * Cast: a new couch session hosted by this profile, named for the TV. Minds the Cast session
 * already up (castToTv); `logData` joins the attempt to what asked for it (the cast prompt's id).
 */
export function castNow(tv: { id: string; name: string }, logData?: LogData) {
  return castOnce.run(() => {
    castStop.reset();
    castSwitch.dismiss();
    const launcher = { launcherToken: () => appState.startSession(tv.name) };
    return castToTv({
      api: launcher,
      config,
      castStore,
      backend: castBackend,
      deviceId: tv.id,
      trace: castTrace,
      logData,
    });
  });
}

/**
 * The app's one cast prompt (CastPrompt.tsx). Its shown / confirmed / dismissed events are the
 * prompt's own (no cast attempt yet); prompt.error belongs to the attempt that just failed.
 */
export const castPrompt = createCastPrompt({
  log: (name, data, level) =>
    castTrace.event(name, {
      level,
      data,
      ...(name === "prompt.error" ? {} : { attemptId: undefined }),
    }),
});

/**
 * Remote → TV picker: "Switching to <TV>…" until the new TV is connected, one switch at a time,
 * the last TV picked wins; the couch session is then told the new TV's name (tv.rename).
 */
export const castSwitch = createCastSwitch({
  castStore,
  onSwitched: announceSwitch((msg) => couchHub.send(msg)),
});

/** Remote → TV picker: the same session (its launcher token) moves to another TV. */
export async function moveToTv(tv: { id: string; name: string }) {
  const launcher = {
    launcherToken: async () =>
      appState.getSnapshot().session?.launcherToken ?? appState.startSession(tv.name),
  };
  return castSwitch.run(tv, () =>
    switchTv({
      api: launcher,
      config,
      castStore,
      backend: castBackend,
      deviceId: tv.id,
      trace: castTrace,
    }),
  );
}

/** Remote → Stop casting: the TV tab shows the Cast screen at once (castStop), then the cast ends. */
export function endTonight() {
  return castStop.stop(async () => {
    const result = await endForTonight({
      send: couchHub.send,
      sessionManager: castBackend.sessionManager,
      trace: castTrace,
    });
    appState.setPill(null);
    await appState.leaveSession();
    return result;
  });
}

/** The cast store a game page sees (game.view to the session while cast through OGS). */
export function gameCastStoreFor(appId: () => string | null) {
  return createGameCastStore(
    castStore,
    () => ({ ogsCast: ogsCastNow(), appId: appId() }),
    couchHub.send,
  );
}

// --- Hooks ----------------------------------------------------------------------------------

export const useApp = () =>
  useSyncExternalStore(appState.subscribe, appState.getSnapshot, appState.getSnapshot);
export const useCouch = () =>
  useSyncExternalStore(couchHub.subscribe, couchHub.getSnapshot, couchHub.getSnapshot);
export const useCast = () =>
  useSyncExternalStore(castStore.subscribe, castStore.getSnapshot, castStore.getSnapshot);

export const useCastSwitch = () =>
  useSyncExternalStore(castSwitch.subscribe, castSwitch.getSnapshot, castSwitch.getSnapshot);

export const useCastStopping = () =>
  useSyncExternalStore(castStop.subscribe, castStop.isStopping, castStop.isStopping);

export function useOgsCast(): boolean {
  useCouch();
  useCast();
  return ogsCastNow();
}

export function usePlaying(now = Date.now()) {
  const app = useApp();
  const couchSnap = useCouch();
  const ttl = (appId: string) =>
    [...app.library, ...app.catalogue].find((g) => g.appId === appId)?.instanceTtlMs ??
    7 * 24 * 60 * 60 * 1000;
  const current = couchSnap.state?.current;
  return playingView(app.instances, {
    now,
    liveInstanceIds: current ? [current.instanceId] : [],
    ttlFor: ttl,
  });
}

/** Resolves true once the TV is cast through OGS (or false after `ms`). */
export function waitForOgsCast(ms: number): Promise<boolean> {
  if (ogsCastNow()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const check = () => {
      if (!ogsCastNow()) return;
      done(true);
    };
    const offCast = castStore.subscribe(check);
    const offCouch = couchHub.subscribe(check);
    const timer = setTimeout(() => done(false), ms);
    function done(v: boolean) {
      clearTimeout(timer);
      offCast();
      offCouch();
      resolve(v);
    }
  });
}
