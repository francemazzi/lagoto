import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { Store } from './storage.js';
import { startAdapter, type Profile, type RunningAdapter, type AdapterEvent } from './adapters.js';
import { type TaskRepository } from './git.js';
import { AppError, now } from './protocol.js';
type ActiveRun = { taskId: string; adapter?: RunningAdapter; stopping: boolean; startup?: Promise<void> };

export class RunManager {
  private active = new Map<string, ActiveRun>();
  private finishing = new Map<string, Promise<void>>();
  private starting = new Set<Promise<unknown>>();
  private permissions = new Map<string, { runId: string; respond: (allow: boolean) => void; timer: NodeJS.Timeout }>();
  constructor(private store: Store, private notify: (event: unknown) => void, private adapterFactory = startAdapter) {}
  private event(taskId: string, runId: string, kind: string, payload: unknown) {
    const event = this.store.event(taskId, runId, kind, payload) as { payload: string } | undefined;
    if (event) this.notify({ ...event, payload: JSON.parse(event.payload) });
  }
  async start(taskId: string, profileId: string, prompt: string, requestId: string, mode: 'plan' | 'agent', secret?: string, effort?: string) {
    const fingerprint = createHash('sha256').update(JSON.stringify({ taskId, profileId, prompt, mode, effort: effort ?? null })).digest('hex');
    const existing = this.store.db.prepare('SELECT run_id,fingerprint FROM run_requests WHERE id=?').get(requestId) as { run_id: string; fingerprint: string | null } | undefined;
    if (existing) {
      const prior = this.store.db.prepare('SELECT * FROM runs WHERE id=?').get(existing.run_id) as { task_id: string; profile_id: string };
      if (existing.fingerprint !== fingerprint) throw new AppError(409, 'Identificativo richiesta già usato con contenuti diversi');
      return prior;
    }
    this.store.task(taskId);
    const profile = this.store.db.prepare('SELECT * FROM profiles WHERE id=? AND enabled=1').get(profileId) as Profile | undefined;
    if (!profile) throw new AppError(404, 'Profilo non disponibile');
    const capabilities = JSON.parse(profile.capabilities);
    if (!capabilities.modes?.includes(mode)) throw new AppError(400, 'Modalità non verificata per questo profilo');
    if (effort && !capabilities.efforts?.includes(effort)) throw new AppError(400, 'Effort non supportato');
    const repositories = this.store.db.prepare('SELECT * FROM task_repositories WHERE task_id=? ORDER BY repository_id').all(taskId) as TaskRepository[];
    if (!repositories.length) throw new AppError(400, 'Prepara i repository del task prima di avviare');
    const runId = randomUUID();
    try {
      this.store.db.transaction(() => {
        this.store.db.prepare('INSERT INTO runs(id,task_id,profile_id,state,model,created_at) VALUES(?,?,?,?,?,?)').run(runId, taskId, profileId, 'starting', profile.model, now());
        this.store.db.prepare('INSERT INTO run_requests(id,run_id,fingerprint) VALUES(?,?,?)').run(requestId, runId, fingerprint);
        this.store.event(taskId, runId, 'user', { text: prompt, mode, effort });
      }).immediate();
    } catch (error: any) { if (error.code?.startsWith('SQLITE_CONSTRAINT')) throw new AppError(409, 'Una run possiede già questi worktree'); throw error; }
    const running: ActiveRun = { taskId, stopping: false };
    this.active.set(runId, running);
    const launch = async () => {
    try {
      const startup = this.adapterFactory({ profile, cwd: repositories[0]!.path, directories: repositories.map(r => r.path), prompt, mode, effort, secret,
        home: join(this.store.directory, 'profiles', profile.id),
        onEvent: (event: AdapterEvent) => this.event(taskId, runId, event.kind, event),
        permission: (tool, input) => new Promise<boolean>(resolve => {
          if (running.stopping) { resolve(false); return; }
          const id = randomUUID();
          const finish = (allow: boolean) => { const p = this.permissions.get(id); if (!p) return; clearTimeout(p.timer); this.permissions.delete(id);
            this.event(taskId, runId, 'permission_result', { id, allow }); resolve(allow); };
          this.permissions.set(id, { runId, respond: finish, timer: setTimeout(() => finish(false), 50000) });
          this.event(taskId, runId, 'permission', { id, tool, input });
        }),
      });
      const adapter = await startup;
      running.adapter = adapter;
      void adapter.completion.then(() => this.finish(runId, running.stopping ? 'interrupted' : 'finished'), error => this.finish(runId, running.stopping ? 'interrupted' : 'failed', error)).catch(() => { /* Persistence failure keeps the durable run active for recovery. */ });
      if (running.stopping) { await this.finish(runId, 'interrupted'); return; }
      this.store.db.prepare("UPDATE runs SET state='running',session_id=? WHERE id=?").run(adapter.sessionId, runId);
      this.event(taskId, runId, 'run_state', { state: 'running', profile: profile.name });
    } catch (error) { await this.finish(runId, 'failed', error); }
    };
    const started = launch(); running.startup = started; this.starting.add(started);
    void started.then(() => this.starting.delete(started), () => this.starting.delete(started));
    // Accept the durable intention immediately, keeping IPC free for approvals and stop.
    return this.store.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
  }
  private finish(runId: string, state: string, error?: unknown): Promise<void> {
    const prior = this.finishing.get(runId); if (prior) return prior;
    const pending = this.finishOnce(runId, state, error);
    this.finishing.set(runId, pending);
    void pending.then(() => this.finishing.delete(runId), () => this.finishing.delete(runId));
    return pending;
  }
  private async finishOnce(runId: string, state: string, error?: unknown) {
    const entry = this.active.get(runId); if (!entry) return;
    for (const permission of [...this.permissions.values()]) if (permission.runId === runId) permission.respond(false);
    let finalState = state;
    try { await entry.adapter?.stop(); } catch (stopError) { finalState = 'unknown'; error = stopError; }
    this.store.db.prepare('UPDATE runs SET state=?,ended_at=?,session_id=COALESCE(?,session_id) WHERE id=?').run(finalState, now(), entry.adapter?.sessionId ?? null, runId);
    this.event(entry.taskId, runId, 'run_state', { state: finalState, message: error instanceof Error ? error.message : undefined });
    this.active.delete(runId);
  }
  answer(runId: string, permissionId: string, allow: boolean) {
    const permission = this.permissions.get(permissionId);
    if (!permission || permission.runId !== runId) throw new AppError(404, 'Autorizzazione scaduta o appartenente a un’altra run');
    permission.respond(allow); return { accepted: true };
  }
  async stop(runId: string) {
    const entry = this.active.get(runId); if (!entry) throw new AppError(409, 'Run non controllabile da questo runtime: riconciliazione richiesta');
    entry.stopping = true;
    for (const permission of [...this.permissions.values()]) if (permission.runId === runId) permission.respond(false);
    await entry.startup;
    if (this.active.has(runId)) this.store.db.prepare("UPDATE runs SET state='stopping' WHERE id=?").run(runId);
    await this.finish(runId, 'interrupted');
    const result = this.store.db.prepare('SELECT state FROM runs WHERE id=?').get(runId) as { state: string };
    if (result.state === 'unknown') throw new AppError(409, 'Arresto non verificato: riconciliazione richiesta');
    return { stopped: true };
  }
  async shutdown() {
    for (const entry of this.active.values()) entry.stopping = true;
    for (const permission of [...this.permissions.values()]) permission.respond(false);
    await Promise.allSettled([...this.starting]);
    await Promise.allSettled([...this.active.keys()].map(id => this.stop(id)));
    await Promise.allSettled([...this.finishing.values()]);
  }
}
