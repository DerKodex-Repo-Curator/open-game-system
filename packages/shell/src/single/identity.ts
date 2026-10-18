import { z } from "zod";

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

/** The slice of expo-secure-store this needs. */
export interface SecureStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export const IDENTITY_KEY = "ogs.identity";

export async function loadIdentity(storage: SecureStorage): Promise<ShellIdentity | null> {
  const raw = await storage.getItemAsync(IDENTITY_KEY);
  if (!raw) return null;
  try {
    const parsed = ShellIdentitySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function saveIdentity(storage: SecureStorage, identity: ShellIdentity): Promise<void> {
  await storage.setItemAsync(IDENTITY_KEY, JSON.stringify(identity));
}
