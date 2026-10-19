import { z } from "zod";
import type { SecureStorage } from "./identity";

/** A profile: what games see (`handle` is the @id without the "@"). Same as the OGS API's. */
export const ShellProfileSchema = z.object({
  id: z.string().min(1),
  handle: z.string().min(1),
  name: z.string().min(1),
  sticker: z.string().min(1),
});
export type ShellProfile = z.infer<typeof ShellProfileSchema>;

/**
 * This device's profile and its device token, plus how it got here: `guest` (made on first
 * launch) or the native login that signed it in.
 */
export const ShellIdentitySchema = z.object({
  profile: ShellProfileSchema,
  deviceId: z.string().min(1),
  deviceToken: z.string().min(1),
  login: z.enum(["guest", "apple", "google"]),
});
export type ShellIdentity = z.infer<typeof ShellIdentitySchema>;

export const IDENTITY_KEY = "ogs.identity";

/** What is stored: the identity plus the OGS API that issued its device token. */
const StoredIdentitySchema = ShellIdentitySchema.extend({ apiBase: z.string().optional() });

/**
 * The stored identity. With `apiBase`, only one saved for that API: a device token is good only on
 * the API that issued it, so a build switched to another API (production ↔ preview) starts over.
 */
export async function loadShellIdentity(
  storage: SecureStorage,
  apiBase?: string,
): Promise<ShellIdentity | null> {
  const raw = await storage.getItemAsync(IDENTITY_KEY);
  // Stryker disable next-line ConditionalExpression: equivalent, JSON.parse("") throws and JSON.parse(null) is null: both load as null
  if (!raw) return null;
  try {
    const parsed = StoredIdentitySchema.safeParse(JSON.parse(raw));
    // Stryker disable next-line ConditionalExpression: equivalent, a failed parse has no data: the destructuring throws and the catch answers null
    if (!parsed.success) return null;
    const { apiBase: savedFor, ...identity } = parsed.data;
    return apiBase === undefined || savedFor === apiBase ? identity : null;
  } catch {
    return null;
  }
}

/** Saves the identity, with the API base that issued its token when given. */
export async function saveShellIdentity(
  storage: SecureStorage,
  identity: ShellIdentity,
  apiBase?: string,
): Promise<void> {
  // Stryker disable next-line ConditionalExpression: equivalent, JSON.stringify leaves out apiBase: undefined
  const stored = apiBase === undefined ? identity : { ...identity, apiBase };
  await storage.setItemAsync(IDENTITY_KEY, JSON.stringify(stored));
}
