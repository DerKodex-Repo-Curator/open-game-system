import { type Context, Hono, type Next } from "hono";
import { z } from "zod";
import { entryStatus, reviewEntry, submitEntry } from "../lib/catalogue-entries";
import { apiError, invalidBody, parseBody, timingSafeEqual } from "../lib/http";
import { checkManifest, fetchProbe, type Probe, parseManifest } from "../lib/manifest-check";
import { type GameKeyEnv, gameKeyAuth } from "../middleware/game-key-auth";

/**
 * The catalogue's developer API (docs/design-docs/ogs-cli.md, `ogs manifest check` / `ogs publish`),
 * mounted at /api/v1: the public manifest check, a game's catalogue entry (its API key), and the
 * admin's review (OGS_ADMIN_TOKEN). GET /api/v1/catalogue (routes/catalogue.ts) serves what's live.
 * `probe` makes the check's live GETs; tests pass a stand-in.
 */

/** The JSON body, whatever its shape; undefined when it isn't JSON. */
async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

/** The catalogue reviewer: `Authorization: Bearer <OGS_ADMIN_TOKEN>`; unset refuses everyone. */
async function adminAuth(c: Context<GameKeyEnv>, next: Next) {
  const expected = c.env.OGS_ADMIN_TOKEN;
  const presented = (c.req.header("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expected || !presented || !timingSafeEqual(presented, expected))
    return apiError(c, 401, "unauthorized", "The admin token is missing or wrong");
  await next();
}

const RejectSchema = z.object({ note: z.string().trim().min(1).max(2000) });

const notPending = (c: Context, appId: string) =>
  apiError(c, 404, "nothing_pending", `${appId} has no submission awaiting review`);

export function catalogueEntries(probe: Probe) {
  const routes = new Hono<GameKeyEnv>();
  const appIdOf = (c: Context<GameKeyEnv>) => c.req.param("appId") ?? "";

  /** POST /manifests/check — public, rate limited per IP; 200 for any JSON body. */
  routes.post("/manifests/check", async (c) => {
    const limiter = c.env.CLIENT_EVENTS_LIMITER;
    const key = `manifest-check:${c.req.header("CF-Connecting-IP") ?? "unknown"}`;
    if (limiter && !(await limiter.limit({ key })).success)
      return apiError(c, 429, "rate_limited", "Too many manifest checks; try again in a minute");
    const raw = await jsonBody(c);
    if (raw === undefined) return invalidBody(c, "Body must be a JSON manifest");
    return c.json(await checkManifest(raw, probe));
  });

  /** PUT /apps/:appId/catalogue-entry — submit (or update) the game's entry for review → 202. */
  routes.put("/apps/:appId/catalogue-entry", gameKeyAuth, async (c) => {
    const appId = appIdOf(c);
    const raw = await jsonBody(c);
    if (raw === undefined) return invalidBody(c, "Body must be a JSON manifest");
    const parsed = parseManifest(raw);
    if ("issues" in parsed)
      return c.json(
        {
          error: {
            code: "invalid_manifest",
            message: parsed.issues.map((i) => `${i.path || "(root)"}: ${i.message}`).join("; "),
            status: 400,
            issues: parsed.issues,
          },
        },
        400,
      );
    if (parsed.manifest.appId !== appId)
      return apiError(
        c,
        400,
        "app_id_mismatch",
        `The manifest's appId is ${parsed.manifest.appId}, not ${appId}`,
      );
    const submittedAt = Date.now();
    await submitEntry(c.env.DB, parsed.manifest, submittedAt);
    return c.json({ appId, status: "pending", submittedAt }, 202);
  });

  /** GET /apps/:appId/catalogue-entry — the entry's review status, live and pending manifests. */
  routes.get("/apps/:appId/catalogue-entry", gameKeyAuth, async (c) =>
    c.json(await entryStatus(c.env.DB, appIdOf(c))),
  );

  /** POST /admin/catalogue-entries/:appId/approve — the pending manifest goes live. */
  routes.post("/admin/catalogue-entries/:appId/approve", adminAuth, async (c) => {
    const appId = appIdOf(c);
    if (!(await reviewEntry(c.env.DB, appId, { approve: true }, Date.now())))
      return notPending(c, appId);
    return c.json(await entryStatus(c.env.DB, appId));
  });

  /** POST /admin/catalogue-entries/:appId/reject `{ note }` — the submission is dropped, the note kept. */
  routes.post("/admin/catalogue-entries/:appId/reject", adminAuth, async (c) => {
    const appId = appIdOf(c);
    const body = await parseBody(c, RejectSchema);
    if (!body) return invalidBody(c, "{ note } (why, for the developer) is required");
    if (!(await reviewEntry(c.env.DB, appId, { approve: false, note: body.note }, Date.now())))
      return notPending(c, appId);
    return c.json(await entryStatus(c.env.DB, appId));
  });

  return routes;
}

export default catalogueEntries(fetchProbe);
