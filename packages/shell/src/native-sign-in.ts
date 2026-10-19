import { z } from "zod";
import { ShellApiError, type ShellRequest } from "./api-client";
import type { ShellDevice } from "./guest-profile";
import type { SecureStorage } from "./identity";
import {
  loadShellIdentity,
  type ShellIdentity,
  type ShellProfile,
  ShellProfileSchema,
  saveShellIdentity,
} from "./shell-identity";

/**
 * Native sign-in (guest first, native upgrade): the shell shows the platform's sheet (Sign in with
 * Apple; Google on Android), trades its identity token at POST /api/v1/auth/native, and keeps the
 * answer as this device's identity. With a guest, the guest's device token goes as
 * `Authorization: Bearer` and its profile id as `deviceProfileId`, so the guest is linked (or, if
 * the login already backs a profile, this device moves to that profile).
 */

export type NativeProvider = "apple" | "google";

/** What a platform sign-in sheet gives back. */
export type NativeCredential =
  | { status: "ok"; identityToken: string; nonce?: string }
  | { status: "cancelled" };

/** One native sign-in (expo-apple-authentication, Google…), behind an interface for tests. */
export interface NativeSignInProvider {
  provider: NativeProvider;
  isAvailable(): Promise<boolean>;
  signIn(): Promise<NativeCredential>;
}

const LoginSchema = z.object({
  provider: z.enum(["apple", "google", "email"]),
  email: z.string().nullable(),
});
/** The profile (the API's `getMe` view) plus this device's new token. */
const NativeSignedInSchema = z.object({
  profile: ShellProfileSchema,
  logins: z.array(LoginSchema),
  token: z.string().min(1),
});
export type NativeSignedIn = z.infer<typeof NativeSignedInSchema>;

export interface NativeAuthRequest {
  provider: NativeProvider;
  identityToken: string;
  nonce?: string;
  deviceProfileId?: string;
  device?: ShellDevice;
}

export interface NativeAuthApi {
  authNative(body: NativeAuthRequest, guestToken?: string): Promise<NativeSignedIn>;
}

export function createNativeAuthApi(request: ShellRequest): NativeAuthApi {
  return {
    authNative: (body, guestToken) =>
      request(NativeSignedInSchema, "/api/v1/auth/native", {
        method: "POST",
        body,
        ...(guestToken ? { token: guestToken } : {}),
      }),
  };
}

export type SignInState =
  | { status: "idle" }
  | { status: "signing-in"; provider: NativeProvider }
  | { status: "signed-in"; provider: NativeProvider; profile: ShellProfile }
  | { status: "cancelled" }
  | { status: "error"; code: string };

export interface NativeSignInDeps {
  api: NativeAuthApi;
  /** The OGS API signed in on: a guest stored for another API is not upgraded. */
  apiBase?: string;
  storage: SecureStorage;
  device: () => Promise<ShellDevice>;
  providers: readonly NativeSignInProvider[];
  /** The new identity, once stored (the runtime refreshes the game's profile with it). */
  onIdentity?: (identity: ShellIdentity) => void;
}

export function createNativeSignIn(deps: NativeSignInDeps) {
  let state: SignInState = { status: "idle" };
  const listeners = new Set<(s: SignInState) => void>();
  const set = (next: SignInState) => {
    state = next;
    for (const l of listeners) l(state);
  };

  async function run(name: NativeProvider): Promise<void> {
    const provider = deps.providers.find((p) => p.provider === name);
    if (!provider) return set({ status: "error", code: "PROVIDER_UNAVAILABLE" });
    let credential: NativeCredential;
    try {
      credential = await provider.signIn();
    } catch {
      return set({ status: "error", code: "PROVIDER_FAILED" });
    }
    if (credential.status === "cancelled") return set({ status: "cancelled" });
    try {
      const guest = await loadShellIdentity(deps.storage, deps.apiBase);
      const device = await deps.device();
      const answer = await deps.api.authNative(
        {
          provider: name,
          identityToken: credential.identityToken,
          ...(credential.nonce ? { nonce: credential.nonce } : {}),
          ...(guest ? { deviceProfileId: guest.profile.id } : {}),
          device,
        },
        guest?.deviceToken,
      );
      const identity: ShellIdentity = {
        profile: answer.profile,
        deviceId: guest?.deviceId ?? device.deviceId,
        deviceToken: answer.token,
        login: name,
      };
      await saveShellIdentity(deps.storage, identity, deps.apiBase);
      deps.onIdentity?.(identity);
      set({ status: "signed-in", provider: name, profile: answer.profile });
    } catch (err) {
      set({ status: "error", code: err instanceof ShellApiError ? err.code : "FAILED" });
    }
  }

  return {
    getState: () => state,
    subscribe(listener: (s: SignInState) => void): () => void {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Shows the provider's native sheet; a start while one runs is ignored. */
    async start(name: NativeProvider): Promise<void> {
      if (state.status === "signing-in") return;
      set({ status: "signing-in", provider: name });
      await run(name);
    },
    reset() {
      if (state.status !== "signing-in") set({ status: "idle" });
    },
  };
}
export type NativeSignIn = ReturnType<typeof createNativeSignIn>;
