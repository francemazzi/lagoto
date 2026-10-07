-- One warning per threshold and allowance (20%, 10%, 0%): never repeated, never lost across restarts.
CREATE TABLE budget_alerts(
  allowance_id TEXT NOT NULL REFERENCES allowances(id),
  threshold INTEGER NOT NULL CHECK(threshold IN (20, 10, 0)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(allowance_id, threshold)
);
