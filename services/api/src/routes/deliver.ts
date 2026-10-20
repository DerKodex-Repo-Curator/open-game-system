import { Hono } from "hono";
import { surfacesOf } from "../lib/handle-surfaces";
import { apiError, invalidBody, parseBody } from "../lib/http";
import { checkTryPath, saveTryPath, TryPathRequestSchema, tryPathOf } from "../lib/try-paths";
import { type GameKeyEnv, gameKeyAuth } from "../middleware/game-key-auth";

/**
 * The deliver group of the developer API (docs/design-docs/ogs-cli.md: `ogs try`, `ogs push send`),
 * mounted at /api/v1 before the games router (whose routes need a profile token). Game key on all.
 */
const deliver = new Hono<GameKeyEnv>();

/** PUT /apps/:appId/try `{ url }` — checks the game's try-kit Worker, then records it. */
deliver.put("/apps/:appId/try", gameKeyAuth, async (c) => {
  // Stryker disable next-line StringLiteral: equivalent, the route always has the param, so the fallback never runs
  const appId = c.req.param("appId") ?? "";
  const body = await parseBody(c, TryPathRequestSchema);
  if (!body) return invalidBody(c, "url (https) is required");
  const failed = await checkTryPath(body.url, (input, init) => fetch(input, init));
  if (failed.length > 0) return apiError(c, 422, "try_path_not_found", failed.join("; "));
  return c.json(await saveTryPath(c.env.DB, appId, body.url, Date.now()));
});

/** GET /apps/:appId/try — the recorded try path. */
deliver.get("/apps/:appId/try", gameKeyAuth, async (c) => {
  // Stryker disable next-line StringLiteral: equivalent, the route always has the param, so the fallback never runs
  const found = await tryPathOf(c.env.DB, c.req.param("appId") ?? "");
  if (!found)
    return apiError(c, 404, "no_try_path", "No try path registered for this game; run: ogs try");
  return c.json(found);
});

/** GET /games/:appId/push-handles/:handle — where a push to this handle would go (sends nothing). */
deliver.get("/games/:appId/push-handles/:handle", gameKeyAuth, async (c) => {
  // Stryker disable next-line StringLiteral: equivalent, the route always has the param, so the fallback never runs
  const handle = c.req.param("handle") ?? "";
  // Stryker disable next-line StringLiteral: equivalent, the route always has the param, so the fallback never runs
  const surfaces = await surfacesOf(c.env.DB, c.req.param("appId") ?? "", handle);
  if (!surfaces)
    return apiError(c, 404, "handle_not_found", "No push handle with that id for this game");
  return c.json({ handle, surfaces });
});

export default deliver;
