import { z } from "zod";

/** A game token lives an hour; the OGS app refreshes it before it expires. */
export const GAME_TOKEN_TTL_S = 60 * 60;

/** Someone a game may know: OGS profile id, @id (without the @), display name, sticker image URL. */
export const GamePlayerSchema = z.object({
  id: z.string().min(1),
  handle: z.string().min(1),
  name: z.string().min(1),
  avatar: z.string().url(),
});
export type GamePlayer = z.infer<typeof GamePlayerSchema>;

/** The couch a token was issued for (spec §7): its session id, and its label (the host's name). */
export const CouchClaimSchema = z.object({ sid: z.string().min(1), label: z.string().min(1) });
export type CouchClaim = z.infer<typeof CouchClaimSchema>;

/**
 * Claims OGS signs (ES256, verifiable with `/.well-known/jwks.json`) into a token for ONE game:
 * `aud` is its appId, so another game can't replay it. A phone/iPad token names its profile; a TV
 * session token also names the session (`sid`) and who's on the couch (`players`). Nothing else:
 * never friends, other games, device ids, push tokens, the app's own token, or age.
 */
export const GameTokenSchema = z.object({
  /** The OGS API that signed it. */
  iss: z.string().min(1),
  /** The game (appId) this token is for. */
  aud: z.string().min(1),
  /** OGS profile id (a session token: the host's). */
  sub: z.string().min(1),
  handle: z.string().min(1),
  name: z.string().min(1),
  avatar: z.string().url(),
  /** The couch session (TV tokens only). */
  sid: z.string().min(1).optional(),
  /** Who's on the couch (TV tokens only). */
  players: z.array(GamePlayerSchema).optional(),
  /** The couch this token was issued for (TV tokens, and phones that asked with their session). */
  couch: CouchClaimSchema.optional(),
  /** Issued at / expiry, seconds since epoch. */
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});
export type GameToken = z.infer<typeof GameTokenSchema>;

/** The painted sticker on the OGS launcher (a sticker that is already a URL stays as it is). */
export function avatarUrl(base: string, sticker: string): string {
  if (/^https?:\/\//.test(sticker)) return sticker;
  return `${base.replace(/\/+$/, "")}/art/story-nook/char-${sticker}.webp`;
}

/** How a single-game app's player is signed in: a guest (device profile), or with Apple or Google. */
export const ProfileLoginSchema = z.enum(["guest", "apple", "google"]);
export type ProfileLogin = z.infer<typeof ProfileLoginSchema>;

/** What `useOgsProfile()` gives a game: the player and a token for this game. */
export const OgsProfileSchema = GamePlayerSchema.extend({
  token: z.string().min(1),
  /**
   * Single-game apps (OGS shell) only: `guest` until the player signs in from the app's native
   * sheet (`SIGN_IN` on the `account` store), then `apple` or `google`. Absent in the OGS app.
   */
  login: ProfileLoginSchema.optional(),
});
export type OgsProfile = z.infer<typeof OgsProfileSchema>;

/**
 * The `profile` app-bridge store the OGS app gives a game's WebView. `asking` while the app fetches
 * the game token, `ready` with it, `none` when there is no profile or no token for this game.
 */
export const ProfileBridgeStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("asking") }),
  z.object({ status: z.literal("ready"), profile: OgsProfileSchema }),
  z.object({ status: z.literal("none") }),
]);
export type ProfileBridgeState = z.infer<typeof ProfileBridgeStateSchema>;
