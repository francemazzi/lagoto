CREATE TABLE process_leases (
 id TEXT PRIMARY KEY, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL,
 leader INTEGER NOT NULL, started TEXT NOT NULL, members TEXT NOT NULL,
 state TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX leases_owner ON process_leases(owner_kind,owner_id);
