CREATE TABLE IF NOT EXISTS devices (
  ogs_device_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  push_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- api_keys (plaintext keys for the removed device-token push, 2026-10-07) is no longer created; see
-- game_api_keys. Production D1 keeps the old table until someone drops it deliberately.

-- Game pushes (docs/product-specs/push-notifications.md). A game server's API key: shown once,
-- stored as a SHA-256 hash (prefix only for display), one game, one scope. Times: ms.
CREATE TABLE IF NOT EXISTS game_api_keys (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_devices_push_token ON devices(push_token);

-- Profiles (OGS profiles slice 1, docs/product-specs/ogs-profiles.html). One profile per device.
-- handle: unique @id without the "@". library: JSON array of catalogue app ids; NULL = whole catalogue.
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sticker TEXT NOT NULL,
  library TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The phone or tablet a profile is on. A device signing in to another profile moves to it.
CREATE TABLE IF NOT EXISTS profile_devices (
  device_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  kind TEXT NOT NULL CHECK (kind IN ('phone', 'tablet')),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Back-up logins: Apple / Google (OIDC subject) or email (lowercased address). One profile each.
CREATE TABLE IF NOT EXISTS profile_logins (
  provider TEXT NOT NULL CHECK (provider IN ('apple', 'google', 'email')),
  subject TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, subject)
);

-- Pending email sign-in codes: SHA-256 of the 6-digit code, expiry in ms, failed attempts.
CREATE TABLE IF NOT EXISTS email_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

-- Couch sessions: one per cast, owned by the caster (host). code: the TV code others join with.
-- created_at: ms since epoch (a session lives as long as its 12 h launcher token).
CREATE TABLE IF NOT EXISTS couch_sessions (
  id TEXT PRIMARY KEY,
  host_profile_id TEXT NOT NULL REFERENCES profiles(id),
  code TEXT NOT NULL UNIQUE,
  tv_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_members (
  session_id TEXT NOT NULL REFERENCES couch_sessions(id),
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, profile_id)
);

-- Instances: one sitting of one game for one profile (ogs-protocol InstanceSchema).
-- your_turn: NULL (not reported), 0 or 1. starts_at and updated_at: ms since epoch.
CREATE TABLE IF NOT EXISTS instances (
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  instance_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('lobby', 'active', 'suspended', 'waiting', 'completed', 'expired')),
  title TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  your_turn INTEGER,
  starts_at INTEGER,
  resume_url TEXT,
  source TEXT NOT NULL CHECK (source IN ('bridge', 'server', 'visit')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, instance_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_devices_profile ON profile_devices(profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_logins_profile ON profile_logins(profile_id);

-- Friends (slice 2). Mutual: one row per pair, profile_a < profile_b. created_at: ms.
CREATE TABLE IF NOT EXISTS friendships (
  profile_a TEXT NOT NULL REFERENCES profiles(id),
  profile_b TEXT NOT NULL REFERENCES profiles(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (profile_a, profile_b),
  CHECK (profile_a < profile_b)
);

-- Pending requests: from asked to by typing a code, opening a link, or finding the @id.
CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY,
  from_profile_id TEXT NOT NULL REFERENCES profiles(id),
  to_profile_id TEXT NOT NULL REFERENCES profiles(id),
  via TEXT NOT NULL CHECK (via IN ('code', 'link', 'handle')),
  created_at INTEGER NOT NULL,
  UNIQUE (from_profile_id, to_profile_id)
);

-- Add a friend: one invite = a short code, a link token and a QR token; 10 min, single use.
CREATE TABLE IF NOT EXISTS friend_invites (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  code TEXT NOT NULL UNIQUE,
  link_token TEXT NOT NULL UNIQUE,
  qr_token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by TEXT REFERENCES profiles(id)
);

-- Presence: when a profile's phone or tablet last reached the API (ms).
CREATE TABLE IF NOT EXISTS profile_seen (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id),
  last_seen_at INTEGER NOT NULL
);

-- Presence: a row while the session's TV launcher is connected (written by the CouchSession DO).
-- app_id: the game running on the TV, if any. since: ms the TV connected.
CREATE TABLE IF NOT EXISTS session_live (
  session_id TEXT PRIMARY KEY REFERENCES couch_sessions(id),
  app_id TEXT,
  since INTEGER NOT NULL
);

-- Several couches, one room (spec §7): the game's room on a session's TV, while it names one
-- (written by the CouchSession DO from game.start / game.room). since: ms the room was set.
CREATE TABLE IF NOT EXISTS session_rooms (
  session_id TEXT PRIMARY KEY REFERENCES couch_sessions(id),
  app_id TEXT NOT NULL,
  room TEXT NOT NULL,
  since INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_rooms_room ON session_rooms(app_id, room);
CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(profile_b);
CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_profile_id);
CREATE INDEX IF NOT EXISTS idx_session_members_profile ON session_members(profile_id);
CREATE INDEX IF NOT EXISTS idx_couch_sessions_host ON couch_sessions(host_profile_id);

-- Beta distribution (docs/adrs/2026-10-07-beta-distribution.md): the latest build CI shipped per
-- platform. Older builds show "Update OGS" and open update_url (TestFlight / Firebase App Tester).
-- fingerprint: the build's native fingerprint (its expo-updates runtime version); CI builds again
-- when it changes. updated_at: ms.
CREATE TABLE IF NOT EXISTS app_releases (
  platform TEXT PRIMARY KEY CHECK (platform IN ('ios', 'android')),
  build INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  update_url TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- A push handle: one player in one game, opaque to the game.
CREATE TABLE IF NOT EXISTS push_handles (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Where a handle can be reached: an OGS profile (the app, by Expo) or a web push subscription on
-- the game's origin. last_active_at: when the player last opened the game there (ms).
CREATE TABLE IF NOT EXISTS push_surfaces (
  id TEXT PRIMARY KEY,
  handle_id TEXT NOT NULL REFERENCES push_handles(id),
  kind TEXT NOT NULL CHECK (kind IN ('ogs', 'web')),
  profile_id TEXT REFERENCES profiles(id),
  endpoint TEXT,
  p256dh TEXT,
  auth TEXT,
  vapid_kid TEXT,
  last_active_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (handle_id, profile_id),
  UNIQUE (handle_id, endpoint)
);

-- Consent in the app, per profile and game. granted 0: turned off in Settings.
CREATE TABLE IF NOT EXISTS push_grants (
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  app_id TEXT NOT NULL,
  granted INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, app_id)
);

-- cast_sessions (v1 casting, removed 2026-10-06) is no longer created. Production D1 keeps the
-- old table until someone drops it deliberately; this file is applied on every deploy, so it
-- never drops anything.
CREATE INDEX IF NOT EXISTS idx_push_surfaces_profile ON push_surfaces(profile_id);

-- Web push (spec §9): one VAPID key pair per game, made on first use. The private key (its `d`) is
-- AES-GCM encrypted under the Worker secret PUSH_KEY_SECRET; public_key is the raw P-256 point.
CREATE TABLE IF NOT EXISTS push_vapid_keys (
  app_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  private_key_enc TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Browser screens (2026-10-17-browser-tv.feature): a browser on the TV that shows a phone's launcher
-- without a Chromecast. code: what the phone types. secret_hash: SHA-256 of the secret only the
-- screen holds. owner_profile_id: the phone's profile that claimed it. token: the launcher token it
-- shows now (NULL: show the code). last_used_at: the claim's life runs from here.
CREATE TABLE IF NOT EXISTS screens (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL,
  owner_profile_id TEXT REFERENCES profiles(id),
  token TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);

-- A white-label app's cast to a screen is chromeless (2026-10-18-cast-chrome-none.feature): the app
-- whose TV page the screen shows with the launcher token (no row: the whole launcher). A table, not a
-- column: schema.sql only creates what doesn't exist.
CREATE TABLE IF NOT EXISTS screen_apps (
  screen_id TEXT PRIMARY KEY REFERENCES screens(id),
  app TEXT NOT NULL
);

-- Guests from the browser (spec ogs-join, "Guests from the browser"): a profile made for one couch
-- session, with no device, login or friends. The couch's members table lists it like any member.
CREATE TABLE IF NOT EXISTS guest_profiles (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id),
  session_id TEXT NOT NULL REFERENCES couch_sessions(id),
  created_at INTEGER NOT NULL
);

-- Invite another family (2026-10-18-invite-another-family.feature): a game link a host sends another
-- household, and how far that household got. The counts are the funnel's (the wide events
-- funnel.* carry the same invite id).
CREATE TABLE IF NOT EXISTS family_invites (
  id TEXT PRIMARY KEY,
  from_profile_id TEXT NOT NULL REFERENCES profiles(id),
  app_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  opened INTEGER NOT NULL DEFAULT 0,
  testflight_taps INTEGER NOT NULL DEFAULT 0,
  first_session_id TEXT,
  first_session_profile_id TEXT,
  first_session_at INTEGER
);

-- White-label apps (2026-10-18-white-label-apps.feature, ADR 2026-10-18-multi-tenant-push): a game's own
-- App Store / Play Store app. One per game per platform; a bundle id / package belongs to one game.
-- ios: store_id = bundle id, team_id set. android: store_id = package, fingerprints and Google
-- client ids (JSON arrays). Times: ms.
CREATE TABLE IF NOT EXISTS native_apps (
  app_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  store_id TEXT NOT NULL,
  team_id TEXT,
  sha256_fingerprints TEXT NOT NULL DEFAULT '[]',
  google_client_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, platform),
  UNIQUE (platform, store_id)
);

-- Each app's push credentials, AES-GCM encrypted under PUSH_KEY_SECRET (src/lib/secret-box.ts).
-- ios: the .p8 with key_id and team_id. android: the FCM service account (project_id, client_email
-- shown; private key only inside secret_enc).
CREATE TABLE IF NOT EXISTS app_push_credentials (
  app_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  key_id TEXT,
  team_id TEXT,
  project_id TEXT,
  client_email TEXT,
  secret_enc TEXT NOT NULL,
  iv TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, platform)
);

-- A device running a game's white-label app: its native push token (APNs device token / FCM
-- registration token) for that app. The OGS app's Expo tokens stay in `devices`.
CREATE TABLE IF NOT EXISTS app_devices (
  device_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  token TEXT NOT NULL,
  apns_environment TEXT CHECK (apns_environment IN ('sandbox', 'production')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, app_id)
);

-- A game's no-app try path (its try-kit Worker), registered with `ogs try` (PUT /api/v1/apps/:appId/try)
-- after OGS checked its / (redirect to a TV page) and /ws-probe (426). The catalogue's tryUrl.
CREATE TABLE IF NOT EXISTS try_paths (
  app_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);

-- A game's catalogue entry (ogs publish; docs/design-docs/ogs-cli.md): manifest_json is the live
-- manifest (in GET /api/v1/catalogue), pending_json the submission awaiting review. A live entry
-- stays live until its update is approved; status is the latest review state.
CREATE TABLE IF NOT EXISTS catalogue_entries (
  app_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'live', 'rejected')),
  manifest_json TEXT,
  pending_json TEXT,
  submitted_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  note TEXT
);
