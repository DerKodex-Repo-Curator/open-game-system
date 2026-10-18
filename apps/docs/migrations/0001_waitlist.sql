-- Bet 4 waitlist: developers who want their web game on the OGS TV. No IP addresses, no user agents.
CREATE TABLE IF NOT EXISTS waitlist (
  email TEXT PRIMARY KEY,
  building TEXT NOT NULL DEFAULT '',
  engine TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  referrer TEXT,
  created_at TEXT NOT NULL
);

-- One row per landing-page view, for signups per source (no personal data).
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  referrer TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS visits_by_source ON visits (utm_source, created_at);
