import { z } from "zod";

/** Numbers only Jon can read (App Store Connect, the clip apps), typed into the board. */
export type Manual = {
  updatedAt: string | null;
  joins: { total: number | null; invite: number | null; coop: number | null };
  /** Views per clip and platform, keyed "<clip id>:<platform>". */
  clipViews: Record<string, number>;
};

export const EMPTY_MANUAL: Manual = { updatedAt: null, joins: { total: null, invite: null, coop: null }, clipViews: {} };

export const ManualSchema = z.object({
  updatedAt: z.string().nullable(),
  joins: z.object({ total: z.number().nullable(), invite: z.number().nullable(), coop: z.number().nullable() }),
  clipViews: z.record(z.string(), z.number()),
});

const count = (v: string | null) => (v !== null && /^\d{1,9}$/.test(v.trim()) ? Number(v.trim()) : null);
const CLIP_KEY = /^views:([a-z0-9-]{1,40}:(tiktok|reels|shorts))$/;

/** The board's form: joins_total, joins_invite, joins_coop and views:<clip>:<platform>. Blank or junk: not set. */
export function parseManual(form: URLSearchParams, now: string): Manual {
  const clipViews: Record<string, number> = {};
  for (const [key, value] of form) {
    const m = CLIP_KEY.exec(key);
    const n = count(value);
    if (m?.[1] && n !== null) clipViews[m[1]] = n;
  }
  return {
    updatedAt: now,
    joins: { total: count(form.get("joins_total")), invite: count(form.get("joins_invite")), coop: count(form.get("joins_coop")) },
    clipViews,
  };
}
