CREATE TABLE budget_cycles(
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES budget_pools(id),
  residual INTEGER NOT NULL,
  reserve INTEGER NOT NULL,
  reset_at TEXT NOT NULL,
  started_at TEXT
);
INSERT INTO budget_cycles(id,pool_id,residual,reserve,reset_at)
SELECT cycle,id,residual,reserve,reset_at FROM budget_pools;
CREATE TABLE budget_changes(
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES budget_pools(id),
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
