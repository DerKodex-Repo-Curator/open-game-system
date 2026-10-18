import {
  normaliseTvCode,
  ScreenClaimedSchema,
  ScreenCreatedSchema,
  ScreenShowSchema,
  ScreenStateSchema,
  TvCodeSchema,
} from "@open-game-system/ogs-protocol";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { apiError, invalidBody, parseBody, timingSafeEqual } from "../lib/http";
import { readClaims } from "../lib/identity";
import {
  createScreen,
  findScreenByCode,
  getScreen,
  hashSecret,
  isLive,
  type ScreenRow,
} from "../lib/screens";
import { getSession } from "../lib/sessions";
import { anyToken, deviceOnly, type ProfileEnv } from "../middleware/profile-auth";

/** What a browser screen is called in the phone's TV list. */
const SCREEN_NAME = "Browser TV";

// The API's own zod (v4) can't pipe into ogs-protocol's (v3) schemas: check the code with a refine.
const ClaimSchema = z.object({
  code: z
    .string()
    .transform(normaliseTvCode)
    .refine((code) => TvCodeSchema.safeParse(code).success),
});

/**
 * Browser screens (2026-10-17-browser-tv.feature): a browser on the TV pairs with a code; the phone
 * that claims it casts its launcher there. Mounted at /api/v1/screens.
 */
const screens = new Hono<ProfileEnv>();

/** POST /screens — a browser opens the TV page: no token, it gets an id, a code and its secret. */
screens.post("/", async (c) =>
  c.json(ScreenCreatedSchema.parse(await createScreen(c.env.DB, Date.now())), 201),
);

/** POST /screens/claim — a phone typed the code: this screen is now one of its TVs. */
screens.post("/claim", anyToken, deviceOnly, async (c) => {
  const body = await parseBody(c, ClaimSchema);
  if (!body) return invalidBody(c, "code (the 6 characters on the screen) is required");
  const now = Date.now();
  const row = await findScreenByCode(c.env.DB, body.code);
  if (!row || !isLive(row, now))
    return apiError(c, 404, "screen_not_found", "No screen shows that code");
  await c.env.DB.prepare("UPDATE screens SET owner_profile_id = ?, last_used_at = ? WHERE id = ?")
    .bind(c.get("claims").sub, now, row.id)
    .run();
  return c.json(ScreenClaimedSchema.parse({ screenId: row.id, name: SCREEN_NAME }));
});

/** GET /screens/:id — the screen asks what to show (X-Screen-Secret). */
screens.get("/:id", async (c) => {
  const secret = c.req.header("X-Screen-Secret");
  if (!secret) return apiError(c, 401, "missing_secret", "X-Screen-Secret header is required");
  const row = await liveScreen(c, c.req.param("id"));
  if (row instanceof Response) return row;
  if (!timingSafeEqual(await hashSecret(secret), row.secret_hash))
    return apiError(c, 403, "wrong_secret", "That isn't this screen's secret");
  return c.json(
    ScreenStateSchema.parse({ code: row.code, show: row.token ? { token: row.token } : null }),
  );
});

/** POST /screens/:id/show — the owner's cast: show its couch's launcher on this screen. */
screens.post("/:id/show", anyToken, deviceOnly, async (c) => {
  const row = await ownedScreen(c);
  if (row instanceof Response) return row;
  const body = await parseBody(c, ScreenShowSchema);
  if (!body) return invalidBody(c, "token (the launcher token) is required");
  const claims = await readClaims(body.token, c.env.OGS_JWT_SECRET, Date.now());
  if (claims?.kind !== "launcher" || !claims.sid)
    return invalidBody(c, "token must be a launcher token");
  const session = await getSession(c.env.DB, claims.sid);
  if (session?.host_profile_id !== c.get("claims").sub)
    return apiError(c, 403, "not_your_couch", "Only the couch's host shows it on a screen");
  await c.env.DB.prepare("UPDATE screens SET token = ?, last_used_at = ? WHERE id = ?")
    .bind(body.token, Date.now(), row.id)
    .run();
  return c.body(null, 204);
});

/** POST /screens/:id/stop — the owner stopped casting: the screen goes back to its code. */
screens.post("/:id/stop", anyToken, deviceOnly, async (c) => {
  const row = await ownedScreen(c);
  if (row instanceof Response) return row;
  await c.env.DB.prepare("UPDATE screens SET token = NULL WHERE id = ?").bind(row.id).run();
  return c.body(null, 204);
});

async function liveScreen(c: Context<ProfileEnv>, id: string): Promise<ScreenRow | Response> {
  const row = await getScreen(c.env.DB, id);
  if (!row || !isLive(row, Date.now()))
    return apiError(c, 404, "screen_not_found", "Screen not found");
  return row;
}

async function ownedScreen(c: Context<ProfileEnv>): Promise<ScreenRow | Response> {
  const row = await liveScreen(c, c.req.param("id") ?? "");
  if (row instanceof Response) return row;
  if (row.owner_profile_id !== c.get("claims").sub)
    return apiError(c, 403, "not_your_screen", "Claim this screen with its code first");
  return row;
}

export default screens;
