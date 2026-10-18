import { z } from "zod";

/** What a game needs from a TV: none (phone only), optional, or required. */
export const TvNeedSchema = z.enum(["none", "optional", "required"]);
export type TvNeed = z.infer<typeof TvNeedSchema>;

export const RoleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  audience: z.enum(["grownup", "kid", "little"]),
});
export type Role = z.infer<typeof RoleSchema>;

/** A game's manifest: everything OGS needs to list, launch, cast and resume it. Config, not code. */
export const ManifestSchema = z.object({
  appId: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  tagline: z.string().default(""),
  shape: z.enum(["couch", "live", "async"]),
  tv: TvNeedSchema,
  /** Played on a phone or tablet (also the controller URL when the TV shows tvUrl). */
  startUrl: z.string().url(),
  /** A static TV page. Room-based games omit it: their phone page sends the room's TV URL at runtime (cast-kit useCastViewUrl). */
  tvUrl: z.string().url().optional(),
  /** The game's no-app try path (its try-kit Worker), set by OGS when `ogs try` registers it. */
  tryUrl: z.string().url().optional(),
  roles: z.array(RoleSchema).default([]),
  art: z.object({
    tile: z.string().min(1),
    hero: z.string().optional(),
    /** The game's art kit: 1:1 icon, 2:3 cover with the title, transparent logo, 16:9 hero with no text or HUD. */
    icon: z.string().min(1).optional(),
    cover: z.string().min(1).optional(),
    logo: z.string().min(1).optional(),
    heroClean: z.string().min(1).optional(),
    /** The game's music theme: a 20–40 s seamless audio loop (music only) the launcher's Home plays while the game is focused. */
    theme: z.string().min(1).optional(),
    safe: z.object({ scale: z.number().positive(), ox: z.number(), oy: z.number() }).optional(),
  }),
  shop: z
    .object({
      ages: z.string().optional(),
      minutes: z.tuple([z.number(), z.number()]).optional(),
      players: z.string().optional(),
    })
    .default({}),
  /** Several couches may join one room of this game (spec §7). Absent = single couch. */
  multiCouch: z.boolean().optional(),
  /** How long an instance may stay silent before it expires (ms). */
  instanceTtlMs: z
    .number()
    .positive()
    .default(7 * 24 * 60 * 60 * 1000),
});
export type Manifest = z.infer<typeof ManifestSchema>;
