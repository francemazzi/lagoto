import { readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { AppError } from './protocol.js';

const migrations = ['001-foundation.sql', '002-run-requests.sql', '003-conversation.sql', '004-budget-pools.sql', '005-task-memory.sql', '006-process-leases.sql', '007-journal-indexes.sql', '008-repository-operations.sql', '009-budget-revisions.sql'];
export function migrate(db: Database.Database) {
  db.exec('CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = db.prepare('SELECT version FROM migrations ORDER BY version').all() as { version: number }[];
  if (applied.some(row => row.version > migrations.length)) throw new AppError(409, 'Archivio creato da una versione più recente di Lagoto');
  for (let i = 0; i < migrations.length; i++) {
    const version = i + 1;
    if (applied.some(row => row.version === version)) continue;
    const sql = readFileSync(new URL(`migrations/${migrations[i]}`, import.meta.url), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      // Early P00 databases contained this table before versioned migration 002.
      if (version === 2 && !(db.pragma('table_info(run_requests)') as { name: string }[]).some(row => row.name === 'fingerprint'))
        db.exec('ALTER TABLE run_requests ADD COLUMN fingerprint TEXT');
      db.prepare('INSERT INTO migrations(version,applied_at) VALUES(?,?)').run(version, new Date().toISOString());
    }).immediate();
  }
}
