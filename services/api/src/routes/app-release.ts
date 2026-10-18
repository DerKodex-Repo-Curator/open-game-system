import { Hono } from "hono";
import { z } from "zod";
import { apiError, invalidBody, parseBody, timingSafeEqual } from "../lib/http";
import type { Env } from "../types";

/**
 * The beta release record (docs/adrs/2026-10-07-beta-distribution.md): one row per platform with
 * the latest build CI shipped. The app reads it (no token) and shows "Update OGS" when it is
 * older; CI writes it (RELEASE_TOKEN) once the build is installable on TestFlight / Firebase.
 */

const Platform = z.enum(["ios", "android"]);

const ReleaseBody = z.object({
  build: z.number().int().positive(),
  fingerprint: z.string().min(1).max(128),
  updateUrl: z
    .string()
    .max(512)
    .url()
    .refine((u) => u.startsWith("https://"), "https only"),
});

const Row = z.object({
  platform: Platform,
  build: z.number(),
  fingerprint: z.string(),
  update_url: z.string(),
  updated_at: z.number(),
});
type Row = z.infer<typeof Row>;

const toJson = (row: Row) => ({
  platform: row.platform,
  build: row.build,
  fingerprint: row.fingerprint,
  updateUrl: row.update_url,
  updatedAt: row.updated_at,
});

async function readRelease(db: D1Database, platform: string): Promise<Row | null> {
  const raw = await db
    .prepare("SELECT * FROM app_releases WHERE platform = ?")
    .bind(platform)
    .first();
  return raw ? Row.parse(raw) : null;
}

function authorized(expected: string | undefined, header: string | undefined): boolean {
  if (!expected || !header?.startsWith("Bearer ")) return false;
  return timingSafeEqual(header.slice("Bearer ".length), expected);
}

const appRelease = new Hono<{ Bindings: Env }>();

appRelease.get("/:platform", async (c) => {
  const platform = Platform.safeParse(c.req.param("platform"));
  if (!platform.success) return apiError(c, 400, "invalid_platform", "Platform is ios or android");
  const row = await readRelease(c.env.DB, platform.data);
  if (!row) return apiError(c, 404, "not_found", "No release recorded for this platform");
  return c.json(toJson(row));
});

appRelease.put("/:platform", async (c) => {
  if (!authorized(c.env.RELEASE_TOKEN, c.req.header("Authorization"))) {
    return apiError(c, 401, "unauthorized", "The release token is missing or wrong");
  }
  const platform = Platform.safeParse(c.req.param("platform"));
  if (!platform.success) return apiError(c, 400, "invalid_platform", "Platform is ios or android");
  const body = await parseBody(c, ReleaseBody);
  if (!body) return invalidBody(c, "Expected { build, fingerprint, updateUrl (https) }");

  // Only a build at least as new as the recorded one replaces it (a re-run records it again).
  const updatedAt = Date.now();
  const result = await c.env.DB.prepare(
    `INSERT INTO app_releases (platform, build, fingerprint, update_url, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(platform) DO UPDATE SET
       build = excluded.build, fingerprint = excluded.fingerprint,
       update_url = excluded.update_url, updated_at = excluded.updated_at
     WHERE excluded.build >= app_releases.build`,
  )
    .bind(platform.data, body.build, body.fingerprint, body.updateUrl, updatedAt)
    .run();
  if (result.meta.changes === 0) {
    return apiError(c, 409, "stale_build", "A newer build is already recorded");
  }
  const row = await readRelease(c.env.DB, platform.data);
  if (!row) return apiError(c, 500, "internal_error", "The release was not recorded");
  return c.json(toJson(row));
});

export default appRelease;
