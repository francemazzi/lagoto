ALTER TABLE repositories ADD COLUMN identity TEXT;
ALTER TABLE projects ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
CREATE TABLE repository_operations(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  repository_id TEXT REFERENCES repositories(id),
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX repository_operations_project ON repository_operations(project_id,created_at);
