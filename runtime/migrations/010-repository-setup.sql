-- Per-repository environment commands (install, build, test) declared by the user; never run implicitly.
ALTER TABLE repositories ADD COLUMN setup TEXT NOT NULL DEFAULT '[]';
