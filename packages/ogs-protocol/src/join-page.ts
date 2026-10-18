import { type JoinPreview, JoinPreviewSchema, normaliseTvCode, TvCodeSchema } from "./join";

/**
 * What the join page (opengame.org/join/<code>) found: the couch, a couch that isn't on any more,
 * something that can't be a TV code, or no answer from OGS.
 */
export type JoinLookup =
  | { kind: "couch"; couch: JoinPreview }
  | { kind: "gone" }
  | { kind: "bad" }
  | { kind: "offline" };

/** The slice of fetch this needs (no DOM types in the protocol package). */
type FetchLike = (
  url: string,
) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

/** Reads the couch behind a TV code from the API (GET /api/v1/join/:code), parsed at the edge. */
export async function loadJoin(api: string, typed: string, fetch: FetchLike): Promise<JoinLookup> {
  const code = TvCodeSchema.safeParse(normaliseTvCode(typed));
  if (!code.success) return { kind: "bad" };
  try {
    const res = await fetch(`${api.replace(/\/+$/, "")}/api/v1/join/${code.data}`);
    if (res.status === 404) return { kind: "gone" };
    if (!res.ok) return { kind: "offline" };
    const couch = JoinPreviewSchema.safeParse(await res.json());
    return couch.success ? { kind: "couch", couch: couch.data } : { kind: "offline" };
  } catch {
    return { kind: "offline" };
  }
}

/** Opens the OGS app on that couch (its link handler joins with the code). */
export const appJoinLink = (code: string) => `opengame://join/${code}`;

/** A sticker's painted character on the launcher's origin; null for anything but a sticker id. */
export function stickerArt(launcher: string, sticker: string): string | null {
  return /^[a-z-]+$/.test(sticker)
    ? `${launcher.replace(/\/+$/, "")}/art/story-nook/char-${sticker}.webp`
    : null;
}
