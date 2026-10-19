import { Hono } from "hono";
import { assetlinks, siteAssociation } from "../lib/app-link-files";
import { apiError, invalidBody, parseBody } from "../lib/http";
import { AndroidAppSchema, appLinks, appOf, appsOf, IosAppSchema, registerApp } from "../lib/native-apps";
import { CredentialsUploadSchema, credentialSummary, storeCredentials } from "../lib/push-credentials";
import { type GameKeyEnv, gameKeyAuth } from "../middleware/game-key-auth";

/**
 * /api/v1/apps — a game's white-label apps (ADR 2026-10-18-multi-tenant-push): registration and push
 * credentials with the game's API key; the public list opengame.org's link files are made from.
 */
const apps = new Hono<GameKeyEnv>();

/** The path's appId (every route below has one). */
const appIdOf = (c: { req: { param: (name: "appId") => string | undefined } }) => c.req.param("appId") ?? "";

/** GET /app-links — public: every registered app (opengame.org AASA / assetlinks). */
apps.get("/app-links", async (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.json(await appLinks(c.env.DB));
});

/** GET /apple-app-site-association, /assetlinks.json — opengame.org's link files, built (public). */
apps.get("/apple-app-site-association", async (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.json(siteAssociation(await appLinks(c.env.DB)));
});
apps.get("/assetlinks.json", async (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.json(assetlinks(await appLinks(c.env.DB)));
});

/** PUT /:appId/native/ios `{ bundleId, teamId }` · /:appId/native/android `{ package, sha256CertFingerprints, googleClientIds }`. */
apps.put("/:appId/native/:platform{ios|android}", gameKeyAuth, async (c) => {
  const appId = appIdOf(c);
  const platform = c.req.param("platform") === "ios" ? "ios" : "android";
  const result =
    platform === "ios"
      ? await (async () => {
          const body = await parseBody(c, IosAppSchema);
          return body ? registerApp(c.env.DB, { appId, platform, ...body }, Date.now()) : null;
        })()
      : await (async () => {
          const body = await parseBody(c, AndroidAppSchema);
          return body ? registerApp(c.env.DB, { appId, platform, ...body }, Date.now()) : null;
        })();
  if (!result)
    return invalidBody(
      c,
      platform === "ios"
        ? "bundleId (reverse DNS) and teamId (10 letters/digits) are required"
        : "package, sha256CertFingerprints (32 hex pairs each) and googleClientIds (…apps.googleusercontent.com) are required",
    );
  if (result.status === "taken") return apiError(c, 409, "app_id_taken", "That bundle id / package is registered to another game");
  return c.json(result.app, result.status === "created" ? 201 : 200);
});

/** GET /:appId/native — the game's registered apps. */
apps.get("/:appId/native", gameKeyAuth, async (c) => c.json({ apps: await appsOf(c.env.DB, appIdOf(c)) }));

/** PUT /:appId/push-credentials `{ ios: { p8, keyId, teamId } }` or `{ android: { serviceAccount } }` → 204. */
apps.put("/:appId/push-credentials", gameKeyAuth, async (c) => {
  const appId = appIdOf(c);
  const secret = c.env.PUSH_KEY_SECRET;
  if (!secret) return apiError(c, 503, "push_unavailable", "Push credentials can't be stored here (no PUSH_KEY_SECRET)");
  const body = await parseBody(c, CredentialsUploadSchema);
  if (!body) return invalidBody(c, "{ ios: { p8, keyId, teamId } } or { android: { serviceAccount } } is required");
  const platform = "ios" in body ? "ios" : "android";
  if (!(await appOf(c.env.DB, appId, platform)))
    return apiError(c, 409, "app_not_registered", `Register the ${platform} app first (PUT /api/v1/apps/${appId}/native/${platform})`);
  if (!(await storeCredentials(c.env.DB, appId, body, secret, Date.now())))
    return apiError(c, 400, "invalid_credentials", platform === "ios" ? "The .p8 isn't a P-256 PKCS#8 private key" : "The service account's private_key isn't an RSA PKCS#8 key");
  return c.body(null, 204);
});

/** GET /:appId/push-credentials — what's configured (ids only, never a key). */
apps.get("/:appId/push-credentials", gameKeyAuth, async (c) => {
  const appId = appIdOf(c);
  const summary = await credentialSummary(c.env.DB, appId);
  const ios = await appOf(c.env.DB, appId, "ios");
  const android = await appOf(c.env.DB, appId, "android");
  return c.json({
    ios: summary.ios.configured ? { ...summary.ios, bundleId: ios?.platform === "ios" ? ios.bundleId : null } : summary.ios,
    android: summary.android.configured ? { ...summary.android, package: android?.platform === "android" ? android.package : null } : summary.android,
  });
});

export default apps;
