import { z } from "zod";

/**
 * Where a push handle would go (`GET /api/v1/games/:appId/push-handles/:handle`, for `ogs push send
 * --check`), read the way lib/push-delivery.ts delivers: `ogs` = the OGS app on a grown-up's phone,
 * `app` = the game's own white-label app on one, `web` = a web push subscription. No ids or tokens.
 */
export interface HandleSurface {
  kind: "ogs" | "web" | "app";
  lastActiveAt: string;
}

const SurfaceRowSchema = z.object({
  kind: z.enum(["ogs", "web"]),
  last_active_at: z.number(),
  ogs_phones: z.number(),
  app_phones: z.number(),
});

/** The handle's surfaces, most recently active first; null when it is not this game's handle. */
export async function surfacesOf(
  db: D1Database,
  appId: string,
  handle: string,
): Promise<HandleSurface[] | null> {
  const owner = await db
    .prepare("SELECT app_id FROM push_handles WHERE id = ?")
    .bind(handle)
    .first<{ app_id: string }>();
  if (owner?.app_id !== appId) return null;
  const { results } = await db
    .prepare(
      `SELECT s.kind, s.last_active_at,
         (SELECT COUNT(*) FROM profile_devices pd JOIN devices d ON d.ogs_device_id = pd.device_id
          WHERE pd.profile_id = s.profile_id AND pd.kind = 'phone') AS ogs_phones,
         (SELECT COUNT(*) FROM profile_devices pd JOIN app_devices ad ON ad.device_id = pd.device_id
          WHERE pd.profile_id = s.profile_id AND pd.kind = 'phone' AND ad.app_id = ?) AS app_phones
       FROM push_surfaces s WHERE s.handle_id = ?
       ORDER BY s.last_active_at DESC, s.created_at DESC`,
    )
    .bind(appId, handle)
    .all();
  return z
    .array(SurfaceRowSchema)
    .parse(results)
    .flatMap((s): HandleSurface[] => {
      const lastActiveAt = new Date(s.last_active_at).toISOString();
      if (s.kind === "web") return [{ kind: "web", lastActiveAt }];
      const surfaces: HandleSurface[] = [];
      if (s.ogs_phones > 0) surfaces.push({ kind: "ogs", lastActiveAt });
      if (s.app_phones > 0) surfaces.push({ kind: "app", lastActiveAt });
      return surfaces;
    });
}
