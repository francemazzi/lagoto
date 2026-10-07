-- Account-level cumulative usage snapshots used to reconcile personal budgets (P09.1, P09.9).
CREATE TABLE usage_snapshots(
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES budget_pools(id),
  cycle TEXT NOT NULL,
  metric TEXT NOT NULL,
  source TEXT NOT NULL,
  cumulative INTEGER NOT NULL CHECK(cumulative >= 0),
  observed_at TEXT NOT NULL,
  local_spent INTEGER NOT NULL DEFAULT 0,
  external INTEGER NOT NULL DEFAULT 0,
  attributed INTEGER NOT NULL DEFAULT 0,
  coverage TEXT NOT NULL DEFAULT 'baseline'
);
CREATE INDEX usage_snapshots_pool ON usage_snapshots(pool_id, cycle, observed_at);
