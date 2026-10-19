import { z } from "zod";
import type { ShellRequest } from "./api-client";
import type { ShellIdentity } from "./shell-identity";

/**
 * Push for a single-game app (OGS hosts push with the developer's own APNs key / FCM account):
 * when the game asks, the shell asks the OS for permission, takes the NATIVE device token
 * (getDevicePushTokenAsync, not an Expo token) and registers it with
 * PUT /api/v1/apps/:appId/devices/:deviceId `{ platform, token, apnsEnvironment }` using the
 * profile's device token. It registers again when the OS rotates the token or the identity changes.
 *
 * apnsEnvironment: which APNs host can deliver to this build. It comes from the build's own
 * `aps-environment` entitlement (expo-application's getIosPushNotificationServiceEnvironmentAsync):
 * "development" (dev-client / development-signed builds) → "sandbox"; "production", or null (App
 * Store and TestFlight builds carry no embedded provisioning profile) → "production". Chosen over an
 * EAS channel or a config flag because it is the signing itself, so it can't disagree with Apple.
 */

export type ApnsEnvironment = "sandbox" | "production";

export function apnsEnvironmentFromEntitlement(
  entitlement: "development" | "production" | null,
): ApnsEnvironment {
  return entitlement === "development" ? "sandbox" : "production";
}

/** The slice of expo-notifications this needs. */
export interface PushNotificationsModule {
  getPermissionsAsync(): Promise<{ granted: boolean }>;
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  getDevicePushTokenAsync(): Promise<{ type: string; data: unknown }>;
  addPushTokenListener(listener: (token: { type: string; data: unknown }) => void): {
    remove(): void;
  };
}

export interface NativePushDeps {
  appId: string;
  request: ShellRequest;
  notifications: PushNotificationsModule;
  platform: "ios" | "android";
  /** iOS only: see apnsEnvironmentFromEntitlement. */
  apnsEnvironment: () => Promise<ApnsEnvironment>;
  /** This device's identity (null before it has a profile). */
  identity: () => Promise<ShellIdentity | null>;
}

export type PushRegistration = "registered" | "not-permitted" | "no-profile" | "failed";

const NativeTokenSchema = z.object({ data: z.string().min(1) });

export function createNativePush(deps: NativePushDeps) {
  /** What was registered last (device, profile token, push token): identical repeats are skipped. */
  let lastKey: string | null = null;
  let pending: Promise<unknown> = Promise.resolve();

  async function put(pushToken: string): Promise<PushRegistration> {
    const identity = await deps.identity();
    if (!identity) return "no-profile";
    const key = `${identity.deviceId}\n${identity.deviceToken}\n${pushToken}`;
    if (key === lastKey) return "registered";
    const body =
      deps.platform === "ios"
        ? { platform: "ios", token: pushToken, apnsEnvironment: await deps.apnsEnvironment() }
        : { platform: "android", token: pushToken };
    try {
      await deps.request(
        z.null(),
        `/api/v1/apps/${encodeURIComponent(deps.appId)}/devices/${encodeURIComponent(identity.deviceId)}`,
        { method: "PUT", body, token: identity.deviceToken },
      );
    } catch (err) {
      console.warn("[ogs-shell] could not register for push:", err);
      return "failed";
    }
    lastKey = key;
    return "registered";
  }

  async function register(opts: { ask: boolean }): Promise<PushRegistration> {
    let { granted } = await deps.notifications.getPermissionsAsync();
    if (!granted && opts.ask)
      granted = (await deps.notifications.requestPermissionsAsync()).granted;
    if (!granted) return "not-permitted";
    const token = NativeTokenSchema.safeParse(await deps.notifications.getDevicePushTokenAsync());
    if (!token.success) return "failed";
    return put(token.data.data);
  }

  async function onRotated(raw: { type: string; data: unknown }): Promise<void> {
    const token = NativeTokenSchema.safeParse(raw);
    // Stryker disable next-line ConditionalExpression: equivalent, a failed parse has no data: the TypeError is swallowed by the pending chain and nothing is sent
    if (!token.success) return;
    const { granted } = await deps.notifications.getPermissionsAsync();
    if (granted) await put(token.data.data);
  }

  return {
    /** `ask`: the game asked, so the OS prompt may show. Without it, only registers if allowed. */
    register: (opts: { ask: boolean }): Promise<PushRegistration> => {
      const job = register(opts);
      pending = pending.then(() => job).catch(() => {});
      return job;
    },
    /** Listens for token rotation; returns the stop function. */
    start(): () => void {
      const sub = deps.notifications.addPushTokenListener((raw) => {
        pending = pending.then(() => onRotated(raw)).catch(() => {});
      });
      return () => sub.remove();
    },
    /** Resolves when every registration started so far has finished (tests, shutdown). */
    idle: (): Promise<void> => pending.then(() => undefined),
  };
}
export type NativePush = ReturnType<typeof createNativePush>;
