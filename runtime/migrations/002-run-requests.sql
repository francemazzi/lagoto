CREATE TABLE IF NOT EXISTS run_requests (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  fingerprint TEXT
);
