import { z } from "zod";
import type { ShellRequest } from "./api-client";
import type { SecureStorage } from "./identity";
import {
  loadShellIdentity,
  type ShellIdentity,
  ShellProfileSchema,
  saveShellIdentity,
} from "./shell-identity";

/**
 * Guest first: on first launch a single-game app makes an OGS device profile with the existing
 * POST /api/v1/profiles `{ name, sticker, device }` (no login) and keeps the answer's device token
 * in SecureStore. The game gets a profile at once; signing in later upgrades this guest.
 */

/** This device, as the API registers it (its id becomes the device token's `did`). */
export interface ShellDevice {
  deviceId: string;
  kind: "phone" | "tablet";
  name: string;
}

/** The Story Nook stickers the OGS app offers (a guest gets one at random). */
export const GUEST_STICKERS = [
  "bear",
  "owl",
  "dragon",
  "dinosaur",
  "turtle",
  "whale",
  "firefly",
  "mouse",
  "cloud",
] as const;

const ProfileCreatedSchema = z.object({ profile: ShellProfileSchema, token: z.string().min(1) });
export type ProfileCreated = z.infer<typeof ProfileCreatedSchema>;

export interface GuestApi {
  createProfile(input: {
    name: string;
    sticker: string;
    device: ShellDevice;
  }): Promise<ProfileCreated>;
}

export function createGuestApi(request: ShellRequest): GuestApi {
  return {
    createProfile: (input) =>
      request(ProfileCreatedSchema, "/api/v1/profiles", { method: "POST", body: input }),
  };
}

export interface GuestDeps {
  api: GuestApi;
  storage: SecureStorage;
  /** This device (id minted once by the caller, e.g. expo-crypto's randomUUID; kind; name). */
  device: () => Promise<ShellDevice>;
  /** The guest's display name (default "Player"). */
  guestName?: string;
  random?: () => number;
}

const inFlight = new WeakMap<SecureStorage, Promise<ShellIdentity>>();

/** The stored identity, or a new guest's. One API call however often it is called at once. */
export function ensureGuestProfile(deps: GuestDeps): Promise<ShellIdentity> {
  const running = inFlight.get(deps.storage);
  if (running) return running;
  const job = makeGuest(deps).finally(() => inFlight.delete(deps.storage));
  inFlight.set(deps.storage, job);
  return job;
}

async function makeGuest(deps: GuestDeps): Promise<ShellIdentity> {
  const stored = await loadShellIdentity(deps.storage);
  if (stored) return stored;
  const device = await deps.device();
  const random = deps.random ?? Math.random;
  const index = Math.min(GUEST_STICKERS.length - 1, Math.floor(random() * GUEST_STICKERS.length));
  const created = await deps.api.createProfile({
    name: deps.guestName ?? "Player",
    sticker: GUEST_STICKERS[index] ?? GUEST_STICKERS[0],
    device,
  });
  const identity: ShellIdentity = {
    profile: created.profile,
    deviceId: device.deviceId,
    deviceToken: created.token,
    login: "guest",
  };
  await saveShellIdentity(deps.storage, identity);
  return identity;
}
