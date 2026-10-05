import Database from 'better-sqlite3';
import { mkdirSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, now, redact } from './protocol.js';
import { migrate } from './migrate.js';
import { projectEvent } from './transcript.js';

export class Store {
  readonly db: Database.Database;
  private lockToken = randomUUID();
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.db = new Database(join(directory, 'lagoto.sqlite'));
    try {
      chmodSync(join(directory, 'lagoto.sqlite'), 0o600);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('busy_timeout = 5000');
      this.db.exec('CREATE TABLE IF NOT EXISTS runtime_owner(id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL, started TEXT NOT NULL, token TEXT NOT NULL)');
      const identity = (pid: number) => { try { return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim(); } catch { return ''; } };
      this.db.transaction(() => {
        const owner = this.db.prepare('SELECT * FROM runtime_owner WHERE id=1').get() as { pid: number; started: string } | undefined;
        if (owner && identity(owner.pid) === owner.started) throw new AppError(409, 'Archivio già aperto da un altro runtime');
        const started = identity(process.pid);
        if (!started) throw new AppError(500, 'Identità del processo non verificabile');
        this.db.prepare('INSERT OR REPLACE INTO runtime_owner VALUES(1,?,?,?)').run(process.pid, started, this.lockToken);
      }).immediate();
      migrate(this.db);
      // Rebuild only once when upgrading a journal that predates the projection.
      if (!this.db.prepare('SELECT 1 FROM transcript LIMIT 1').get()) {
        this.db.transaction(() => {
          for (const event of this.db.prepare('SELECT * FROM events ORDER BY seq').iterate()) projectEvent(this.db, event as any);
        })();
      }
      this.db.prepare("UPDATE runs SET state='unknown' WHERE state IN ('starting','running','stopping','waiting_permission')").run();
      this.db.prepare("UPDATE verifications SET state='unknown' WHERE state='running'").run();
      this.db.prepare("UPDATE profile_checks SET state='failed',detail=? WHERE state='checking'").run(JSON.stringify({message:'Verifica interrotta dal riavvio: ripetere la prova'}));
      this.db.prepare("UPDATE profiles SET capabilities=? WHERE json_extract(capabilities,'$.verification')='checking'").run(JSON.stringify({verification:'failed',modes:[],efforts:[]}));
    } catch (error) { try { this.releaseLock(); } catch {} finally { this.db.close(); } throw error; }
  }
  private releaseLock() {
    this.db.prepare('DELETE FROM runtime_owner WHERE token=?').run(this.lockToken);
  }
  close() { if (this.db.open) { this.releaseLock(); this.db.close(); } }
  project(id: string) { const result = this.db.prepare('SELECT * FROM projects WHERE id=?').get(id); if (!result) throw new AppError(404, 'Progetto non trovato'); return result; }
  task(id: string) { const result = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id); if (!result) throw new AppError(404, 'Task non trovato'); return result as { id: string; project_id: string; title: string; objective: string; status: string }; }
  event(taskId: string, runId: string | null, kind: string, payload: unknown, sourceKey?: string) {
    return this.db.transaction(() => {
      const id = randomUUID();
      const result = this.db.prepare('INSERT OR IGNORE INTO events(id,task_id,run_id,kind,payload,source_key,created_at) VALUES(?,?,?,?,?,?,?)').run(id, taskId, runId, kind, JSON.stringify(redact(payload)), sourceKey ?? null, now());
      if (!result.changes) return undefined;
      const event = this.db.prepare('SELECT * FROM events WHERE id=?').get(id) as any;
      projectEvent(this.db,event); return event;
    })();
  }
  events(taskId: string, after = 0) {
    return (this.db.prepare('SELECT * FROM events WHERE task_id=? AND seq>? ORDER BY seq LIMIT 500').all(taskId, after) as { payload: string }[]).map(e => ({ ...e, payload: JSON.parse(e.payload) }));
  }
}
