CREATE TABLE IF NOT EXISTS discovered_tokens (
  mint TEXT PRIMARY KEY,
  pool_address TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  price_usd REAL,
  liquidity_usd REAL,
  volume_24h_usd REAL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'geckoterminal'
);
CREATE INDEX IF NOT EXISTS idx_discovered_tokens_last_seen ON discovered_tokens(last_seen_at DESC);
CREATE TABLE IF NOT EXISTS scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL,
  source TEXT NOT NULL,
  pools_received INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_scan_runs_ran_at ON scan_runs(ran_at DESC);
