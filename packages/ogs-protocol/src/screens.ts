import { z } from "zod";
import { TvCodeSchema } from "./join";

/**
 * Browser screens (2026-10-17-browser-tv.feature): a browser on the TV shows the launcher without a
 * Chromecast. It pairs with a code a phone types; the phone's cast then shows its launcher there.
 */

/** POST /api/v1/screens — a new screen: its id, the code it shows, the secret only it keeps. */
export const ScreenCreatedSchema = z.object({
  screenId: z.string().min(1),
  code: TvCodeSchema,
  secret: z.string().min(32),
});
export type ScreenCreated = z.infer<typeof ScreenCreatedSchema>;

/** GET /api/v1/screens/:id (X-Screen-Secret) — its code, and the launcher to show, if any. */
export const ScreenStateSchema = z.object({
  code: TvCodeSchema,
  show: z.object({ token: z.string().min(1) }).nullable(),
});
export type ScreenState = z.infer<typeof ScreenStateSchema>;

/** POST /api/v1/screens/claim — the phone's new TV: the screen it can cast to. */
export const ScreenClaimedSchema = z.object({ screenId: z.string().min(1), name: z.string() });
export type ScreenClaimed = z.infer<typeof ScreenClaimedSchema>;

/** POST /api/v1/screens/:id/show — the launcher token of the couch session the phone casts. */
export const ScreenShowSchema = z.object({ token: z.string().min(1) });
