CREATE TABLE IF NOT EXISTS rate_limit_state (
  endpoint TEXT NOT NULL,
  client_ip TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (endpoint, client_ip)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_state_updated_at
ON rate_limit_state(updated_at DESC);

CREATE TABLE IF NOT EXISTS request_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket_timestamp INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  path TEXT NOT NULL,
  method TEXT NOT NULL,
  status INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  sanitized_message TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_request_observations_bucket
ON request_observations(bucket_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_request_observations_observed_at
ON request_observations(observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_observations_status_observed_at
ON request_observations(status, observed_at DESC);
