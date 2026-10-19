import type { Manifest } from "@open-game-system/ogs-protocol";
import { z } from "zod";

/**
 * A game's no-app try path (docs/design-docs/ogs-cli.md, `PUT /api/v1/apps/:appId/try`): its own
 * try-kit Worker, which OGS checks before recording it, and the catalogue offers as `tryUrl`.
 */

/** `PUT /apps/:appId/try` body: an https URL. */
export const TryPathRequestSchema = z.object({
  url: z.url({ protocol: /^https$/ }),
});

export interface TryPath {
  appId: string;
  url: string;
  checkedAt: string;
}

const CHECK_TIMEOUT_MS = 5000;

/** `<url>/<path>`: the try path's own route under its URL (which may have a path of its own). */
const under = (url: string, path: string) => `${url.replace(/\/+$/, "")}/${path}`;

async function answer(
  fetchFn: typeof fetch,
  url: string,
): Promise<{ res: Response } | { error: string }> {
  try {
    return {
      res: await fetchFn(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      }),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * try-kit's two routes, checked: `GET <url>/` redirects (3xx with a Location) to a new room's TV
 * page, and `GET <url>/ws-probe` without an Upgrade header answers 426. Returns what failed, one line
 * per check (empty: it is a try path). `fetchFn` is injected so tests never reach the network.
 */
export async function checkTryPath(url: string, fetchFn: typeof fetch): Promise<string[]> {
  const front = under(url, "");
  const probe = under(url, "ws-probe");
  const [home, ws] = await Promise.all([answer(fetchFn, front), answer(fetchFn, probe)]);
  const failed: string[] = [];
  if ("error" in home) failed.push(`GET ${front} failed: ${home.error}`);
  else if (!(home.res.status >= 300 && home.res.status < 400 && home.res.headers.get("Location")))
    failed.push(`GET ${front} answered ${home.res.status}, not a redirect to a TV page`);
  if ("error" in ws) failed.push(`GET ${probe} failed: ${ws.error}`);
  else if (ws.res.status !== 426)
    failed.push(`GET ${probe} answered ${ws.res.status}, not 426 (try-kit's wsProbe)`);
  return failed;
}

const RowSchema = z.object({ app_id: z.string(), url: z.string(), checked_at: z.number() });
const toTryPath = (row: z.infer<typeof RowSchema>): TryPath => ({
  appId: row.app_id,
  url: row.url,
  checkedAt: new Date(row.checked_at).toISOString(),
});

/** Records the checked URL (a newer one replaces it). */
export async function saveTryPath(
  db: D1Database,
  appId: string,
  url: string,
  now: number,
): Promise<TryPath> {
  await db
    .prepare(
      `INSERT INTO try_paths (app_id, url, checked_at) VALUES (?, ?, ?)
       ON CONFLICT(app_id) DO UPDATE SET url = excluded.url, checked_at = excluded.checked_at`,
    )
    .bind(appId, url, now)
    .run();
  return toTryPath({ app_id: appId, url, checked_at: now });
}

export async function tryPathOf(db: D1Database, appId: string): Promise<TryPath | null> {
  const row = await db
    .prepare("SELECT app_id, url, checked_at FROM try_paths WHERE app_id = ?")
    .bind(appId)
    .first();
  return row ? toTryPath(RowSchema.parse(row)) : null;
}

/** The catalogue with each game's registered try path as its `tryUrl`. */
export async function withTryUrls(db: D1Database, games: readonly Manifest[]): Promise<Manifest[]> {
  const { results } = await db.prepare("SELECT app_id, url, checked_at FROM try_paths").all();
  const urls = new Map(
    z
      .array(RowSchema)
      .parse(results)
      .map((r) => [r.app_id, r.url]),
  );
  return games.map((m) => {
    const tryUrl = urls.get(m.appId);
    return tryUrl ? { ...m, tryUrl } : m;
  });
}
