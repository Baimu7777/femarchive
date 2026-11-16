-- Public submission receiver. Apply once:
--   wrangler d1 execute archive-submissions --remote --file=schema.sql
-- Every statement is idempotent, so applying it again is harmless.

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Quota counters. A row is one bucket (one source for one day, the whole site
-- for one day, the bytes held in the bucket). Expired rows are swept daily.
CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS counters_expiry ON counters (expires_at);

-- `source` is a keyed hash of the submitter's address, never the address.
CREATE TABLE IF NOT EXISTS bans (
  source TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS submissions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  received_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  trusted INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  text_chars INTEGER NOT NULL DEFAULT 0,
  body_bytes INTEGER NOT NULL DEFAULT 0,
  image_count INTEGER NOT NULL DEFAULT 0,
  image_bytes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS submissions_received ON submissions (received_at);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  session TEXT NOT NULL,
  source TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  submission_id TEXT
);
CREATE INDEX IF NOT EXISTS images_session ON images (session);
CREATE INDEX IF NOT EXISTS images_submission ON images (submission_id);
CREATE INDEX IF NOT EXISTS images_orphans ON images (created_at) WHERE submission_id IS NULL;
