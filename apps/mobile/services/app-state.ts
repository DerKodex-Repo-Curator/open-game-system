import type { Instance, InstanceReport, Manifest } from "@open-game-system/ogs-protocol";
import { z } from "zod";
import {
  clearIdentity,
  type Identity,
  loadIdentity,
  type SecureStorage,
  saveIdentity,
} from "./identity";
import type { ReturnPill } from "./leave-game";
import {
  type Credential,
  type DeviceInfo,
  type InstanceSource,
  type Login,
  type Me,
  type OgsApi,
  OgsApiError,
  type ProfilePatch,
  SessionInfoSchema,
} from "./ogs-api";
import { type ErrorAction, type ErrorContext, type UserMessage, userMessage } from "./user-message";

/**
 * The app's shared data: this device's profile, its games and instances, the couch session it is
 * on, and the return pill. One small external store (useSyncExternalStore in screens); the API is
 * injected.
 */

/** The couch session this device is on: one it hosts (cast from here) or one it joined by code. */
export const CouchSessionInfoSchema = SessionInfoSchema.extend({
  role: z.enum(["host", "member"]),
  /** The launcher's token (host only): a TV switch re-casts the same session with it. */
  launcherToken: z.string().min(1).optional(),
});
export type CouchSessionInfo = z.infer<typeof CouchSessionInfoSchema>;

export interface AppData {
  identity: Identity | null;
  /** How this profile is backed up (empty = not backed up). */
  logins: Login[];
  session: CouchSessionInfo | null;
  catalogue: Manifest[];
  library: Manifest[];
  instances: Instance[];
  status: "idle" | "loading" | "ready" | "offline";
  /** The last load failure, in words people read (with its one action). */
  error: UserMessage | null;
  pill: ReturnPill | null;
}

type Api = Pick<
  OgsApi,
  | "checkHandle"
  | "createProfile"
  | "me"
  | "updateMe"
  | "createSession"
  | "joinSession"
  | "joinFriendSession"
  | "startEmail"
  | "backUp"
  | "signIn"
  | "catalogue"
  | "library"
  | "setLibrary"
  | "instances"
  | "reportInstance"
  | "fetchManifest"
>;

/** A refusal the screen handles (`reason`), with the words to show and the one action to offer. */
export type Failure<R extends string> = {
  ok: false;
  reason: R | "error";
  message: string;
  action: ErrorAction;
};
export type Done = { ok: true };
export type HandleResult =
  | Done
  | { ok: false; reason: "handle_taken"; suggestion: string }
  | Failure<never>;

const SESSION_KEY = "ogs.session";

/** An API error with one of the codes the caller handles, else a plain error to show. */
function failure<R extends string>(
  err: unknown,
  codes: readonly R[],
  context: ErrorContext,
): Failure<R> {
  const { text: message, action } = userMessage(err, context);
  const code = err instanceof OgsApiError ? codes.find((c) => c === err.code) : undefined;
  return { ok: false, reason: code ?? "error", message, action };
}

const isTaken = (err: unknown) => err instanceof OgsApiError && err.code === "handle_taken";

export function createAppState(opts: {
  /** The invite another family this phone came through (invite-attribution.ts). */
  invite?: { current(): Promise<string | null>; clear(): Promise<void> };
  api: Api;
  storage: SecureStorage;
  /** This device as the API registers it (minus its id, minted per profile token). */
  device: Omit<DeviceInfo, "deviceId">;
  newDeviceId: () => string;
  /**
   * Whether this is the install's first launch (a marker in app storage, which deleting the app
   * wipes). The Keychain is not wiped on iOS, so a deleted app's profile must be forgotten here.
   */
  install?: { isFirstLaunch(): Promise<boolean>; markLaunched(): Promise<void> };
}) {
  let appIds: string[] = [];
  const libraryOf = (catalogue: Manifest[]) =>
    appIds.flatMap((id) => catalogue.filter((g) => g.appId === id));
  let data: AppData = {
    identity: null,
    logins: [],
    session: null,
    catalogue: [],
    library: [],
    instances: [],
    status: "idle",
    error: null,
    pill: null,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<AppData>) => {
    data = { ...data, ...patch };
    for (const l of listeners) l();
  };

  const deviceInfo = (): DeviceInfo => ({ deviceId: opts.newDeviceId(), ...opts.device });

  async function keepIdentity(identity: Identity, logins: Login[]) {
    await saveIdentity(opts.storage, identity);
    set({ identity, logins, error: null });
  }

  async function keepMe(me: Me) {
    const id = data.identity;
    if (id) await keepIdentity({ ...id, profile: me.profile }, me.logins);
  }

  async function keepSession(session: CouchSessionInfo | null) {
    if (session) await opts.storage.setItemAsync(SESSION_KEY, JSON.stringify(session));
    else await opts.storage.deleteItemAsync(SESSION_KEY);
    set({ session });
  }

  async function readSession(): Promise<CouchSessionInfo | null> {
    const raw = await opts.storage.getItemAsync(SESSION_KEY);
    if (!raw) return null;
    try {
      const parsed = CouchSessionInfoSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** A taken @id: ask OGS for a free one to offer instead. */
  async function takenAnswer(handle: string): Promise<HandleResult> {
    try {
      const { suggestion } = await opts.api.checkHandle({ handle });
      return { ok: false, reason: "handle_taken", suggestion };
    } catch (checkErr) {
      return failure(checkErr, [], "profile");
    }
  }

  return {
    getSnapshot: (): AppData => data,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Load this device's stored profile and the session it was on. */
    async init() {
      if (opts.install && (await opts.install.isFirstLaunch())) {
        await opts.storage.deleteItemAsync(SESSION_KEY);
        await clearIdentity(opts.storage);
        await opts.install.markLaunched();
      }
      const [identity, session] = await Promise.all([loadIdentity(opts.storage), readSession()]);
      set({ identity, session: identity ? session : null });
    },
    /** Onboarding: make this device's profile (one per device). */
    async createProfile(input: {
      name: string;
      handle?: string;
      sticker: string;
    }): Promise<HandleResult> {
      if (data.identity) return { ok: true };
      const device = deviceInfo();
      try {
        const { profile, token } = await opts.api.createProfile({ ...input, device });
        await keepIdentity({ profile, deviceId: device.deviceId, deviceToken: token }, []);
        return { ok: true };
      } catch (err) {
        if (isTaken(err) && input.handle) return takenAnswer(input.handle);
        return failure(err, [], "profile");
      }
    },
    async updateProfile(patch: ProfilePatch): Promise<HandleResult> {
      try {
        await keepMe(await opts.api.updateMe(patch));
        return { ok: true };
      } catch (err) {
        if (isTaken(err) && patch.handle) return takenAnswer(patch.handle);
        return failure(err, [], "edit");
      }
    },
    async startEmail(email: string): Promise<Done | Failure<never>> {
      try {
        await opts.api.startEmail(email);
        return { ok: true };
      } catch (err) {
        return failure(err, [], "sign-in");
      }
    },
    /** Back up: link a login to this device's profile. */
    async backUp(credential: Credential): Promise<Done | Failure<"login_in_use" | "invalid_code">> {
      try {
        await keepMe(await opts.api.backUp(credential));
        return { ok: true };
      } catch (err) {
        return failure(err, ["login_in_use", "invalid_code"] as const, "back-up");
      }
    },
    /** Sign in: this device takes the profile that has this login, with its own new token. */
    async signIn(
      credential: Credential,
    ): Promise<Done | Failure<"login_not_found" | "invalid_code">> {
      const device = deviceInfo();
      try {
        const { me, token } = await opts.api.signIn(credential, device);
        await keepIdentity(
          { profile: me.profile, deviceId: device.deviceId, deviceToken: token },
          me.logins,
        );
        return { ok: true };
      } catch (err) {
        return failure(err, ["login_not_found", "invalid_code"] as const, "sign-in");
      }
    },
    /** Cast: a new couch session hosted by this profile. Returns the launcher's token. */
    async startSession(tvName: string): Promise<string> {
      // The invite this household came through goes with its cast, once (the API counts it).
      const invite = await opts.invite?.current();
      const { token, ...info } = invite
        ? await opts.api.createSession(tvName, invite)
        : await opts.api.createSession(tvName);
      if (invite) await opts.invite?.clear();
      await keepSession({ ...info, launcherToken: token, role: "host" });
      return token;
    },
    /** Join the cast whose TV shows `code`. */
    async joinSession(code: string): Promise<Done | Failure<"session_not_found">> {
      try {
        const info = await opts.api.joinSession(code.trim().toUpperCase());
        await keepSession({ ...info, role: "member" });
        return { ok: true };
      } catch (err) {
        return failure(err, ["session_not_found"] as const, "join");
      }
    },
    /** Join a friend's cast from its Join card (only the host's friends may). */
    async joinFriendSession(
      sessionId: string,
    ): Promise<Done | Failure<"session_not_found" | "not_a_friend">> {
      try {
        const info = await opts.api.joinFriendSession(sessionId);
        await keepSession({ ...info, role: "member" });
        return { ok: true };
      } catch (err) {
        return failure(err, ["session_not_found", "not_a_friend"] as const, "join");
      }
    },
    async leaveSession() {
      await keepSession(null);
    },
    /** OGS no longer takes this device's token: forget the profile here (sign in or make one). */
    async signOut() {
      await keepSession(null);
      await clearIdentity(opts.storage);
      set({ identity: null, logins: [] });
    },
    /** Library = the profile's appIds, as catalogue manifests, in its order. */
    async refresh() {
      set({ status: data.status === "ready" ? "ready" : "loading" });
      const signedIn = !!data.identity;
      try {
        const [catalogue, ids, instances, me] = await Promise.all([
          opts.api.catalogue(),
          signedIn ? opts.api.library() : Promise.resolve(appIds),
          signedIn ? opts.api.instances() : Promise.resolve(data.instances),
          signedIn ? opts.api.me() : Promise.resolve(null),
        ]);
        appIds = ids;
        if (me) await keepMe(me);
        set({ catalogue, library: libraryOf(catalogue), instances, status: "ready", error: null });
      } catch (err) {
        set({ status: "offline", error: userMessage(err, "load") });
      }
    },
    async addGame(appId: string) {
      if (appIds.includes(appId)) return;
      appIds = await opts.api.setLibrary([...appIds, appId]);
      set({ library: libraryOf(data.catalogue) });
    },
    /** Add by link: the manifest must parse; OGS only takes catalogue games for now. */
    async addByLink(url: string): Promise<Manifest> {
      const manifest = await opts.api.fetchManifest(url);
      if (!data.catalogue.some((g) => g.appId === manifest.appId))
        throw new OgsApiError(
          "NOT_IN_CATALOGUE",
          `${manifest.name} isn't in the OGS catalogue yet, so it can't be added by link.`,
          0,
        );
      await this.addGame(manifest.appId);
      return manifest;
    },
    async report(report: InstanceReport, source: InstanceSource) {
      const saved = await opts.api.reportInstance(report, source);
      set({
        instances: [saved, ...data.instances.filter((i) => i.instanceId !== saved.instanceId)],
      });
    },
    setPill(pill: ReturnPill | null) {
      set({ pill });
    },
  };
}

export type AppState = ReturnType<typeof createAppState>;
