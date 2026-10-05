CREATE TABLE budget_pools (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, unit TEXT NOT NULL CHECK(unit='tokens'),
 residual INTEGER NOT NULL, reserve INTEGER NOT NULL CHECK(reserve>=0),
 reset_at TEXT NOT NULL, cycle TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Europe/Rome'
);
CREATE TABLE profile_pools (
 profile_id TEXT PRIMARY KEY REFERENCES profiles(id), pool_id TEXT NOT NULL REFERENCES budget_pools(id),
 reservation INTEGER NOT NULL CHECK(reservation>0)
);
CREATE TABLE run_budgets (
 run_id TEXT PRIMARY KEY REFERENCES runs(id), pool_id TEXT NOT NULL REFERENCES budget_pools(id),
 allowance_id TEXT NOT NULL REFERENCES allowances(id), reported INTEGER, settled INTEGER NOT NULL DEFAULT 0
);
