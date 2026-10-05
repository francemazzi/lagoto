CREATE TABLE transcript (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), run_id TEXT REFERENCES runs(id),
  kind TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}',
  first_seq INTEGER NOT NULL, last_seq INTEGER NOT NULL
);
CREATE INDEX transcript_task ON transcript(task_id,first_seq);
CREATE TABLE queued_messages (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), text TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL
);
CREATE TABLE handoffs (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), profile_id TEXT NOT NULL REFERENCES profiles(id),
  state TEXT NOT NULL, checkpoint_id TEXT REFERENCES checkpoints(id), context TEXT, context_hash TEXT,
  successor_id TEXT REFERENCES runs(id), created_at TEXT NOT NULL, error TEXT
);
CREATE UNIQUE INDEX one_pending_handoff ON handoffs(task_id) WHERE state IN ('stopping','checkpoint','preview','starting','unknown');
CREATE TABLE preparations (
  task_id TEXT NOT NULL REFERENCES tasks(id), repository_id TEXT NOT NULL REFERENCES repositories(id),
  path TEXT NOT NULL UNIQUE, branch TEXT NOT NULL, base TEXT NOT NULL, state TEXT NOT NULL,
  PRIMARY KEY(task_id,repository_id)
);
CREATE TABLE profile_checks (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id), state TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
