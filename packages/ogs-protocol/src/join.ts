import { z } from "zod";

/** Where the TV's join QR points (spec ogs-join: opengame.org/join/<code>). */
export const JOIN_BASE = "https://opengame.org";

/** The letters a TV code is drawn from: no 0/O, 1/I/L, so it reads off a TV across the room. */
export const TV_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A couch session's TV code: six characters from the TV's alphabet. */
export const TvCodeSchema = z.string().regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/);

/** What someone typed ("nt9-wph ") as a code ("NT9WPH"). */
export const normaliseTvCode = (typed: string) => typed.toUpperCase().replace(/[\s-]/g, "");

/** `<base>/join/<code>`: what the TV's QR encodes. */
export function joinLink(base: string, code: string): string {
  return `${base.replace(/\/+$/, "")}/join/${code}`;
}

/** A join link (any origin, or the app's scheme: `opengame://join/<code>`) as its TV code. */
export function readJoinLink(url: string): { code: string } | null {
  const m = /^(?:[a-z]+:\/\/[^/?#]+\/|[a-z]+:\/\/)join\/([A-Za-z0-9]+)\/?(?:[?#].*)?$/.exec(url);
  if (!m?.[1]) return null;
  const code = TvCodeSchema.safeParse(normaliseTvCode(m[1]));
  return code.success ? { code: code.data } : null;
}

/** Someone on a couch, as the join page shows them: a name and a sticker, never an id. */
export const JoinSitterSchema = z.object({ name: z.string(), sticker: z.string() });

/**
 * GET /api/v1/join/:code — what the join page (opengame.org/join/<code>) shows before anyone has an
 * OGS profile: the TV, its host and who is on the couch (host first, then in join order).
 */
export const JoinPreviewSchema = z.object({
  code: TvCodeSchema,
  tvName: z.string(),
  host: JoinSitterSchema,
  couch: z.array(JoinSitterSchema),
});
export type JoinPreview = z.infer<typeof JoinPreviewSchema>;

/**
 * POST /api/v1/join/:code/guest `{ name, sticker }` — a guest from the browser (spec ogs-join,
 * "Guests from the browser"): the couch it is on and a phone token for its browser.
 */
export const GuestJoinedSchema = z.object({
  token: z.string().min(1),
  sessionId: z.string().min(1),
  code: TvCodeSchema,
  tvName: z.string(),
});
export type GuestJoined = z.infer<typeof GuestJoinedSchema>;
