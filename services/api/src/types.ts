import type { CouchSession } from "./couch-session";

export interface Env {
  DB: D1Database;
  OGS_JWT_SECRET: string;
  COUCH_SESSION: DurableObjectNamespace<CouchSession>;
  CLOUDFLARE_TURN_API_TOKEN: string;
  CLOUDFLARE_TURN_KEY_ID: string;
  CLOUDFLARE_REALTIME_APP_ID: string;
  CLOUDFLARE_REALTIME_APP_SECRET: string;
  DEBUG_STATE_TOKEN?: string;
  /** CI's bearer token for PUT /api/v1/app-release/:platform (a secret). Unset: every write is refused. */
  RELEASE_TOKEN?: string;
  /** The catalogue reviewer's bearer token for /api/v1/admin/catalogue-entries/* (a secret). Unset: every review is refused. */
  OGS_ADMIN_TOKEN?: string;
  STREAM_SERVER_URL?: string;
  /** Sign in with Apple / Google: OIDC issuers (default: the real ones) and accepted client ids (CSV). */
  APPLE_ISSUER?: string;
  APPLE_CLIENT_IDS?: string;
  GOOGLE_ISSUER?: string;
  GOOGLE_CLIENT_IDS?: string;
  /**
   * Email codes: Cloudflare Email Service's `send_email` binding and the sender address (on a
   * domain onboarded to Email Sending). Without the binding, email sign-in answers 503.
   */
  SEND_EMAIL?: SendEmail;
  EMAIL_FROM: string;
  /** Game tokens (slice 3): the private ES256 JWK (secret) and where sticker art is served. */
  OGS_GAME_SIGNING_KEY?: string;
  AVATAR_BASE_URL?: string;
  /** Local dev / e2e only: JSON `{ appId: startUrl }` pointing catalogue games at local servers. */
  CATALOGUE_START_URLS?: string;
  /** Friend invite links and QR codes: `<base>/<token>` (default https://opengame.org/add). */
  INVITE_BASE_URL?: string;
  /** Game invite links: `<base>/play/<appId>?room=` (default https://opengame.org). */
  PLAY_BASE_URL?: string;
  /** POST /client-events: Workers rate limiting, keyed per profile (the receiver per IP). */
  CLIENT_EVENTS_LIMITER?: RateLimit;
  /** Web push: encrypts each game's VAPID private key (secret). Unset: web push answers 503. */
  PUSH_KEY_SECRET?: string;
  /** The VAPID subject push services can reach OGS at (default https://opengame.org). */
  PUSH_VAPID_SUBJECT?: string;
  /** Expo push access token (secret), when the Expo project requires one for sending. */
  EXPO_ACCESS_TOKEN?: string;
  /** The game-developer docs site: GET /dev/kits points at its pages and <base>/pkg/*.tgz (default https://ogs-docs.pages.dev). */
  OGS_DOCS_BASE?: string;
  /** The deployed version (wrangler `version_metadata`); its id is every wide event's `version`. */
  CF_VERSION_METADATA?: WorkerVersionMetadata;
}

export interface DeviceRow {
  ogs_device_id: string;
  platform: "ios" | "android";
  push_token: string;
  created_at: string;
  updated_at: string;
}
