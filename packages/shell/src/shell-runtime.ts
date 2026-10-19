import { createNativeBridge } from "@open-game-system/app-bridge-native";
import type {
  BridgeStores,
  Event,
  NativeBridge,
  State,
  Store,
} from "@open-game-system/app-bridge-types";
import { createAccountStore } from "./account-store";
import { createShellRequest, type ShellRequest } from "./api-client";
import type { FetchLike, OgsApiOptions } from "./api-request";
import { castLauncherUrl } from "./cast-launcher-url";
import { type CastPicker, createCastPicker } from "./cast-picker";
import { createGuestApi, ensureGuestProfile, type ShellDevice } from "./guest-profile";
import { createHapticsStore, type HapticsPlayer } from "./haptics-store";
import type { SecureStorage } from "./identity";
import {
  type ApnsEnvironment,
  createNativePush,
  type PushNotificationsModule,
  type PushRegistration,
} from "./native-push";
import {
  createNativeAuthApi,
  createNativeSignIn,
  type NativeProvider,
  type NativeSignInProvider,
  type SignInState,
} from "./native-sign-in";
import type { ShellIdentity } from "./shell-identity";
import { webViewUrlFor } from "./shell-links";

/** What the runtime needs from the shell config (`extra.ogsShell`) plus the API base. */
export interface ShellRuntimeConfig {
  appId: string;
  gameUrl: string;
  name: string;
  /** The OGS API, e.g. https://api.opengame.org */
  apiBase: string;
  linkDomains: readonly string[];
  /** The app's custom URL schemes (`<scheme>://…` links open in the game); default: the appId. */
  schemes?: readonly string[];
  /** The OGS TV launcher the Chromecast shows (default https://ogs-tv.pages.dev). */
  tvBase?: string;
  /** The guest profile's name (default "Player"). */
  guestName?: string;
}

/** What other stores (cast, profile, notifications, ogs…) get from the runtime. */
export interface ShellContext {
  config: ShellRuntimeConfig;
  /** The OGS API request (parsed answers, ShellApiError failures). */
  request: ShellRequest;
  /** For the OGS app's API clients (createApiRequest): the current device token as `auth`. */
  apiOptions: OgsApiOptions;
  getIdentity(): ShellIdentity | null;
  /** Called with each new identity (the guest once made, then each sign-in). */
  onIdentity(listener: (identity: ShellIdentity | null) => void): () => void;
  /** The game asked for push: OS prompt if needed, then register this device with OGS. */
  requestPush(): Promise<PushRegistration>;
  /** Called when the runtime stops (the shell unmounts): close timers and listeners. */
  onStop(listener: () => void): void;
  /** The shell's native TV picker: the cast store attaches its TVs and opens it (SHOW_CAST_PICKER). */
  castPicker: CastPicker;
}

type AnyStore = Store<State, Event>;

export interface ShellRuntimeDeps {
  fetch: FetchLike;
  storage: SecureStorage;
  device: () => Promise<ShellDevice>;
  notifications: PushNotificationsModule;
  platform: "ios" | "android";
  apnsEnvironment: () => Promise<ApnsEnvironment>;
  haptics: HapticsPlayer;
  signInProviders: readonly NativeSignInProvider[];
  /** The game's other bridge stores, built with the runtime's context. */
  gameStores?: (ctx: ShellContext) => Record<string, AnyStore>;
}

export interface SignInSheetState {
  visible: boolean;
  providers: NativeProvider[];
  signIn: SignInState;
}

/**
 * One game's native runtime: the app bridge with the shell's stores (account, haptics, and the
 * game's cast/profile/notifications stores), the guest profile, native sign-in, native push, links
 * and the cast URL. React-free; <OgsShell /> renders it.
 */
export function createShellRuntime(config: ShellRuntimeConfig, deps: ShellRuntimeDeps) {
  const request = createShellRequest({ baseUrl: config.apiBase, fetch: deps.fetch });
  let identity: ShellIdentity | null = null;
  const identityListeners = new Set<(id: ShellIdentity | null) => void>();
  let pending: Promise<unknown> = Promise.resolve();
  const track = <T>(p: Promise<T>): Promise<T> => {
    pending = pending.then(() => p).catch(() => {});
    return p;
  };

  // Before anything that may tell the page (the sign-in flow reports at once on subscribe).
  const account = createAccountStore({ requestSignIn: () => void track(openSignIn()) });

  const setIdentity = (next: ShellIdentity | null) => {
    identity = next;
    account.setLogin(next ? next.login : "none");
    for (const l of identityListeners) l(next);
  };

  const push = createNativePush({
    appId: config.appId,
    request,
    notifications: deps.notifications,
    platform: deps.platform,
    apnsEnvironment: deps.apnsEnvironment,
    identity: async () => identity,
  });

  // The sign-in sheet's state, for React (useSyncExternalStore).
  let sheet: SignInSheetState = { visible: false, providers: [], signIn: { status: "idle" } };
  const sheetListeners = new Set<() => void>();
  const setSheet = (patch: Partial<SignInSheetState>) => {
    sheet = { ...sheet, ...patch };
    for (const l of sheetListeners) l();
  };

  const signIn = createNativeSignIn({
    api: createNativeAuthApi(request),
    storage: deps.storage,
    device: deps.device,
    providers: deps.signInProviders,
    onIdentity: (id) => {
      setIdentity(id);
      void track(push.register({ ask: false }));
    },
  });
  signIn.subscribe((s) => {
    account.setSigningIn(s.status === "signing-in");
    setSheet(s.status === "signed-in" ? { signIn: s, visible: false } : { signIn: s });
  });

  async function openSignIn(): Promise<void> {
    if (identity && identity.login !== "guest") return;
    const offered: NativeProvider[] = [];
    for (const p of deps.signInProviders) if (await p.isAvailable()) offered.push(p.provider);
    signIn.reset();
    setSheet({ visible: true, providers: offered });
  }

  const stopListeners = new Set<() => void>();
  const castPicker = createCastPicker();
  const ctx: ShellContext = {
    castPicker,
    config,
    request,
    apiOptions: {
      baseUrl: config.apiBase,
      fetch: deps.fetch,
      auth: () => (identity ? { token: identity.deviceToken } : null),
    },
    getIdentity: () => identity,
    onIdentity(listener) {
      identityListeners.add(listener);
      return () => {
        identityListeners.delete(listener);
      };
    },
    requestPush: () => track(push.register({ ask: true })),
    onStop(listener) {
      stopListeners.add(listener);
    },
  };

  const bridge: NativeBridge<BridgeStores> = createNativeBridge<BridgeStores>();
  bridge.setStore("account", account.store);
  bridge.setStore("haptics", createHapticsStore(deps.haptics));
  for (const [key, store] of Object.entries(deps.gameStores?.(ctx) ?? {}))
    bridge.setStore(key, store);

  let stopPush: (() => void) | null = null;
  /** Bumped by each start and stop: a start that finishes after a stop changes nothing. */
  let run = 0;

  return {
    bridge,
    config,
    castPicker,
    getIdentity: () => identity,
    onIdentity: ctx.onIdentity,
    requestPush: ctx.requestPush,
    /** Guest profile (or the stored identity), then push if it is already allowed. */
    async start(): Promise<void> {
      stopPush ??= push.start();
      const mine = ++run;
      try {
        const guest = await ensureGuestProfile({
          api: createGuestApi(request),
          storage: deps.storage,
          device: deps.device,
          guestName: config.guestName,
        });
        if (mine !== run) return;
        setIdentity(guest);
      } catch (err) {
        console.warn("[ogs-shell] no OGS profile yet:", err);
        return;
      }
      await track(push.register({ ask: false }));
    },
    stop() {
      stopPush?.();
      stopPush = null;
      run++;
      for (const l of stopListeners) l();
    },
    sheet: {
      getSnapshot: () => sheet,
      subscribe(listener: () => void): () => void {
        sheetListeners.add(listener);
        return () => {
          sheetListeners.delete(listener);
        };
      },
    },
    openSignIn: () => track(openSignIn()),
    closeSignIn() {
      signIn.reset();
      setSheet({ visible: false });
    },
    signInWith: (provider: NativeProvider) => track(signIn.start(provider)),
    webViewUrlFor: (incoming: string) => webViewUrlFor(incoming, config),
    castUrl: (launcherUrl: string) => castLauncherUrl(launcherUrl, config.appId),
    /** Resolves when the work started so far (sign-in, push, page events) has finished. */
    idle: async (): Promise<void> => {
      await pending;
      await push.idle();
    },
  };
}
export type ShellRuntime = ReturnType<typeof createShellRuntime>;
