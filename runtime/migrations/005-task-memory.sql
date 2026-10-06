ALTER TABLE decisions ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy-unverified';
ALTER TABLE decisions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE decisions ADD COLUMN supersedes TEXT REFERENCES decisions(id);
CREATE TABLE criteria (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), content TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'open',
 verification_id TEXT REFERENCES verifications(id), override_reason TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE criteria_history (
 criterion_id TEXT NOT NULL REFERENCES criteria(id), revision INTEGER NOT NULL,
 content TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(criterion_id,revision)
);
