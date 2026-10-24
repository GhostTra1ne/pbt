CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  server TEXT NOT NULL,
  clan TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '',
  reporter TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at TEXT,
  telegram_message_id INTEGER,
  telegram_claimed_at INTEGER
);
CREATE INDEX IF NOT EXISTS submissions_status_date ON submissions(status, reviewed_at DESC);
CREATE TABLE IF NOT EXISTS rate_limits (
  ip_hash TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(ip_hash, bucket)
);
