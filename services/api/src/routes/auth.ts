import type { Claims } from "@open-game-system/ogs-protocol";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { CODE_TTL_MS, checkCode, codeEmail, hashCode, newEmailCode } from "../lib/email-code";
import { cloudflareEmailSender } from "../lib/email-sender";
import { apiError, invalidBody, parseBody } from "../lib/http";
import { signInAudiences } from "../lib/native-apps";
import { type OidcProvider, type VerifiedLogin, verifyIdToken } from "../lib/oidc";
import {
  type Device,
  DeviceSchema,
  deviceToken,
  getMe,
  getProfile,
  type Provider,
  upsertDevice,
} from "../lib/profiles";
import { recordError } from "../lib/wide-event";
import { claimsFromHeader, type ProfileEnv } from "../middleware/profile-auth";
import type { Env } from "../types";

const IdTokenBodySchema = z.object({
  idToken: z.string().min(1),
  nonce: z.string().min(1).optional(),
  device: DeviceSchema.optional(),
});
const EmailSchema = z.string().trim().toLowerCase().pipe(z.email());
const EmailStartSchema = z.object({ email: EmailSchema });
const EmailVerifySchema = z.object({
  email: EmailSchema,
  code: z.string().regex(/^\d{6}$/),
  device: DeviceSchema.optional(),
});
const StoredCodeSchema = z.object({
  code_hash: z.string(),
  expires_at: z.number(),
  attempts: z.number(),
});

const list = (csv: string | undefined) =>
  (csv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Providers come from env so tests (and local dev) point them at vercel-labs/emulate. */
function oidcProvider(env: Env, provider: "apple" | "google"): OidcProvider {
  if (provider === "apple")
    return {
      issuer: env.APPLE_ISSUER ?? "https://appleid.apple.com",
      clientIds: list(env.APPLE_CLIENT_IDS),
    };
  const issuer = env.GOOGLE_ISSUER ?? "https://accounts.google.com";
  return {
    issuer,
    clientIds: list(env.GOOGLE_CLIENT_IDS),
    issuerAliases: issuer === "https://accounts.google.com" ? ["accounts.google.com"] : [],
  };
}

type Who = { kind: "link"; claims: Claims } | { kind: "sign-in"; device: Device };

/** With a profile token: back up (link). Without: sign in, which needs the device. */
async function who(
  c: Context<ProfileEnv>,
  device: Device | undefined,
): Promise<Who | { error: Response }> {
  if (!c.req.header("Authorization")) {
    if (!device)
      return { error: invalidBody(c, "device { deviceId, kind, name } is required to sign in") };
    return { kind: "sign-in", device };
  }
  const result = await claimsFromHeader(c);
  if ("error" in result) return result;
  if (result.claims.kind === "launcher")
    return {
      error: apiError(
        c,
        403,
        "profile_token_required",
        "Needs the profile's phone or tablet token",
      ),
    };
  return { kind: "link", claims: result.claims };
}

async function finish(c: Context<ProfileEnv>, w: Who, provider: Provider, login: VerifiedLogin) {
  const ownerId = await loginOwner(c.env.DB, provider, login.subject);
  return w.kind === "link"
    ? link(c, w.claims.sub, ownerId, provider, login)
    : signIn(c, ownerId, w.device);
}

/** The profile a login backs up, if any. */
async function loginOwner(db: D1Database, provider: Provider, subject: string) {
  const owner = await db
    .prepare("SELECT profile_id FROM profile_logins WHERE provider = ? AND subject = ?")
    .bind(provider, subject)
    .first();
  return owner ? z.object({ profile_id: z.string() }).parse(owner).profile_id : null;
}

/** Back up profile `me` with the login (a no-op when it already does). */
async function link(
  c: Context<ProfileEnv>,
  me: string,
  ownerId: string | null,
  provider: Provider,
  login: VerifiedLogin,
) {
  if (ownerId && ownerId !== me)
    return apiError(c, 409, "login_in_use", "That login backs up another profile");
  // Checked first: the insert below would hit the foreign key for a deleted profile.
  if (!(await getProfile(c.env.DB, me)))
    return apiError(c, 404, "profile_not_found", "Profile not found");
  if (!ownerId)
    await c.env.DB.prepare(
      "INSERT INTO profile_logins (provider, subject, profile_id, email) VALUES (?, ?, ?, ?)",
    )
      .bind(provider, login.subject, me, login.email)
      .run();
  return c.json(await getMe(c.env.DB, me));
}

/** Put the device on the login's profile and hand it a device token. */
async function signIn(c: Context<ProfileEnv>, ownerId: string | null, device: Device) {
  const view = ownerId ? await getMe(c.env.DB, ownerId) : null;
  if (!ownerId || !view)
    return apiError(c, 404, "login_not_found", "No profile is backed up with that login");
  await upsertDevice(c.env.DB, ownerId, device).run();
  const token = await deviceToken(ownerId, device, c.env.OGS_JWT_SECRET);
  return c.json({ ...view, token });
}

const auth = new Hono<ProfileEnv>();

for (const provider of ["apple", "google"] as const) {
  /** POST /auth/apple, /auth/google — `{ idToken, nonce?, device? }`. */
  auth.post(`/${provider}`, async (c) => {
    const body = await parseBody(c, IdTokenBodySchema);
    if (!body) return invalidBody(c, "idToken is required");
    const w = await who(c, body.device);
    if ("error" in w) return w.error;
    const login = await verifyIdToken(body.idToken, oidcProvider(c.env, provider), {
      now: Date.now(),
      nonce: body.nonce,
    });
    if (!login) return apiError(c, 401, "invalid_id_token", `Not a valid ${provider} ID token`);
    return finish(c, w, provider, login);
  });
}

const NativeBodySchema = z.object({
  provider: z.enum(["apple", "google"]),
  identityToken: z.string().min(1),
  nonce: z.string().min(1).optional(),
  deviceProfileId: z.string().min(1).optional(),
  device: DeviceSchema.optional(),
});

/**
 * POST /auth/native — a game's white-label app (2026-10-18-white-label-native-sign-in.feature):
 * `{ provider, identityToken, nonce?, deviceProfileId?, device? }`. Apple / Google audiences: the OGS
 * app's plus every registered app's. With a guest (its own device token as Bearer + deviceProfileId),
 * a new login backs the guest up, and a login that backs another profile takes the device.
 */
auth.post("/native", async (c) => {
  const body = await parseBody(c, NativeBodySchema);
  if (!body) return invalidBody(c, "provider (apple | google) and identityToken are required");
  const w = await nativeWho(c, body);
  if ("error" in w) return w.error;
  const login = await verifyIdToken(
    body.identityToken,
    await nativeProvider(c.env, body.provider),
    {
      now: Date.now(),
      nonce: body.nonce,
    },
  );
  if (!login)
    return apiError(
      c,
      401,
      "invalid_id_token",
      `Not a valid ${body.provider} identity token for a registered app`,
    );
  const ownerId = await loginOwner(c.env.DB, body.provider, login.subject);
  if ("device" in w) return signIn(c, ownerId, w.device);
  return guestLogin(c, w.guest, ownerId, body.provider, login);
});

/** A guest's login: a new one backs the guest up; one that backs another profile takes the device. */
async function guestLogin(
  c: Context<ProfileEnv>,
  guest: Claims,
  ownerId: string | null,
  provider: Provider,
  login: VerifiedLogin,
) {
  const device = await guestDevice(c.env.DB, guest);
  if (ownerId && ownerId !== guest.sub)
    // The login backs another profile: this device signs in to it (the guest profile stays as it was).
    return signIn(c, ownerId, device);
  const linked = await link(c, guest.sub, ownerId, provider, login);
  // Stryker disable next-line ConditionalExpression: equivalent, link() fails here only with 404 profile_not_found, which withToken() answers too
  if (linked.status !== 200) return linked;
  return withToken(c, guest.sub, device);
}

type NativeWho = { guest: Claims } | { device: Device };

/** A guest proven by its own device token (deviceProfileId), or a sign-in on a new device. */
async function nativeWho(
  c: Context<ProfileEnv>,
  body: z.infer<typeof NativeBodySchema>,
): Promise<NativeWho | { error: Response }> {
  if (!body.deviceProfileId) {
    if (!body.device)
      return { error: invalidBody(c, "deviceProfileId (with its token) or device is required") };
    return { device: body.device };
  }
  const claims = await guestClaims(c, body.deviceProfileId);
  if (!claims)
    return {
      error: apiError(
        c,
        403,
        "not_your_profile",
        "Send the guest profile's own device token with deviceProfileId",
      ),
    };
  return { guest: claims };
}

/** The Bearer token's claims when they are that guest profile's own phone or tablet. */
async function guestClaims(c: Context<ProfileEnv>, profileId: string): Promise<Claims | null> {
  const result = await claimsFromHeader(c);
  if ("error" in result) return null;
  const { claims } = result;
  return claims.sub === profileId && claims.kind !== "launcher" ? claims : null;
}

/** Apple / Google audiences: the OGS app's plus every registered app's. */
async function nativeProvider(env: Env, provider: "apple" | "google"): Promise<OidcProvider> {
  const base = oidcProvider(env, provider);
  return { ...base, clientIds: [...base.clientIds, ...(await signInAudiences(env.DB, provider))] };
}

/** The guest's device as it is known (its name kept), for the token it gets back. */
async function guestDevice(db: D1Database, guest: Claims): Promise<Device> {
  const named = await db
    .prepare("SELECT name FROM profile_devices WHERE device_id = ?")
    .bind(guest.did)
    .first<{ name: string }>();
  return {
    deviceId: guest.did,
    kind: guest.kind === "tablet" ? "tablet" : "phone",
    name: named?.name ?? "Phone",
  };
}

async function withToken(c: Context<ProfileEnv>, profileId: string, device: Device) {
  const view = await getMe(c.env.DB, profileId);
  // Stryker disable next-line ConditionalExpression,StringLiteral: equivalent, only called after link() answered 200, which read the profile (null needs it deleted in between)
  if (!view) return apiError(c, 404, "profile_not_found", "Profile not found");
  return c.json({ ...view, token: await deviceToken(profileId, device, c.env.OGS_JWT_SECRET) });
}

/**
 * POST /auth/email/start — emails a 6-digit code with Cloudflare Email Service (SEND_EMAIL).
 * A new start replaces the old code.
 */
auth.post("/email/start", async (c) => {
  const body = await parseBody(c, EmailStartSchema);
  if (!body) return invalidBody(c, "a valid email is required");
  const binding = c.env.SEND_EMAIL;
  if (!binding) return apiError(c, 503, "email_unavailable", "Email sign-in is not configured");
  const code = newEmailCode();
  await c.env.DB.prepare(
    `INSERT INTO email_codes (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash,
       expires_at = excluded.expires_at, attempts = 0`,
  )
    .bind(body.email, await hashCode(body.email, code), Date.now() + CODE_TTL_MS)
    .run();
  try {
    await cloudflareEmailSender(binding, c.env.EMAIL_FROM).send(body.email, codeEmail(code));
  } catch (error) {
    recordError(c, error);
    return apiError(c, 502, "email_failed", "Couldn't send the email");
  }
  return c.json({ sent: true }, 202);
});

/** POST /auth/email/verify — `{ email, code, device? }`: back up or sign in with the code. */
auth.post("/email/verify", async (c) => {
  const body = await parseBody(c, EmailVerifySchema);
  if (!body) return invalidBody(c, "email and a 6-digit code are required");
  const w = await who(c, body.device);
  if ("error" in w) return w.error;
  const db = c.env.DB;
  const row = await db
    .prepare("SELECT code_hash, expires_at, attempts FROM email_codes WHERE email = ?")
    .bind(body.email)
    .first();
  const invalid = () => apiError(c, 401, "invalid_code", "That code is wrong or has expired");
  if (!row) return invalid();
  const stored = StoredCodeSchema.parse(row);
  const verdict = checkCode(
    { codeHash: stored.code_hash, expiresAt: stored.expires_at, attempts: stored.attempts },
    await hashCode(body.email, body.code),
    Date.now(),
  );
  if (verdict === "wrong") {
    await db
      .prepare("UPDATE email_codes SET attempts = attempts + 1 WHERE email = ?")
      .bind(body.email)
      .run();
    return invalid();
  }
  await db.prepare("DELETE FROM email_codes WHERE email = ?").bind(body.email).run();
  if (verdict !== "ok") return invalid();
  return finish(c, w, "email", { subject: body.email, email: body.email });
});

export default auth;
