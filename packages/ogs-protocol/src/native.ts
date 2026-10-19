import { z } from "zod";

/**
 * Bridge stores a game page can use inside a native app (the OGS app, or a single-game app built
 * with the OGS shell). Outside an app there is no bridge: these are simply never sent.
 */

/** The `haptics` app-bridge store: the page asks the device to tap the player's hand. */
export const HapticsBridgeEventSchema = z.discriminatedUnion("type", [
  /** A physical tap, for a press, a hit or a landing. */
  z.object({
    type: z.literal("IMPACT"),
    /** How hard the tap is. */
    style: z.enum(["light", "medium", "heavy"]),
  }),
  /** The pattern for an outcome: a win, a near miss, a mistake. */
  z.object({
    type: z.literal("NOTIFY"),
    /** Which outcome. */
    kind: z.enum(["success", "warning", "error"]),
  }),
]);
export type HapticsBridgeEvent = z.infer<typeof HapticsBridgeEventSchema>;

/**
 * The `account` app-bridge store (single-game apps): how this device is signed in, and a way for
 * the game to show the app's native sign-in sheet. The game itself has no sign-in UI; after a
 * sign-in it hears the new player through the `profile` store.
 */
export const AccountBridgeStateSchema = z.object({
  /** `none`: no profile yet; `guest`: a device profile; `apple` / `google`: signed in with that. */
  login: z.enum(["none", "guest", "apple", "google"]),
  /** The native sign-in sheet is open or the sign-in is on its way. */
  signingIn: z.boolean(),
});
export type AccountBridgeState = z.infer<typeof AccountBridgeStateSchema>;

export const AccountBridgeEventSchema = z.discriminatedUnion("type", [
  /** Show the app's native sign-in sheet (from a tap, for example "Save your progress"). */
  z.object({ type: z.literal("SIGN_IN") }),
]);
export type AccountBridgeEvent = z.infer<typeof AccountBridgeEventSchema>;
