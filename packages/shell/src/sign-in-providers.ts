import { z } from "zod";
import type { NativeCredential, NativeProvider, NativeSignInProvider } from "./native-sign-in";

/**
 * The slice of `expo-apple-authentication` the shell uses. The app passes the module in
 * (`import * as AppleAuthentication from "expo-apple-authentication"`), so the shell has no hard
 * dependency on it (an optional peer) and tests use a fake.
 */
export interface AppleAuthModule {
  AppleAuthenticationScope: { FULL_NAME: number; EMAIL: number };
  isAvailableAsync(): Promise<boolean>;
  signInAsync(options: {
    requestedScopes?: number[];
    nonce?: string;
  }): Promise<{ identityToken: string | null }>;
}

const CodedErrorSchema = z.object({ code: z.string() });

/**
 * Sign in with Apple. The nonce is sent to Apple as is and to OGS as is (the API checks the token's
 * `nonce` claim equals it).
 */
export function appleSignIn(mod: AppleAuthModule, newNonce: () => string): NativeSignInProvider {
  return {
    provider: "apple",
    isAvailable: () => mod.isAvailableAsync(),
    async signIn(): Promise<NativeCredential> {
      const nonce = newNonce();
      let credential: { identityToken: string | null };
      try {
        credential = await mod.signInAsync({
          requestedScopes: [
            mod.AppleAuthenticationScope.FULL_NAME,
            mod.AppleAuthenticationScope.EMAIL,
          ],
          nonce,
        });
      } catch (err) {
        const coded = CodedErrorSchema.safeParse(err);
        if (coded.success && coded.data.code === "ERR_REQUEST_CANCELED")
          return { status: "cancelled" };
        throw err;
      }
      if (!credential.identityToken) throw new Error("Apple gave no identity token");
      return { status: "ok", identityToken: credential.identityToken, nonce };
    },
  };
}

/** A provider this platform doesn't offer (Google on iOS in v1): never shown. */
export function unavailableSignIn(provider: NativeProvider): NativeSignInProvider {
  return {
    provider,
    isAvailable: async () => false,
    signIn: async () => {
      throw new Error(`${provider} sign-in is not available on this device`);
    },
  };
}
