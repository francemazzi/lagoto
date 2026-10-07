import type Database from 'better-sqlite3';

/**
 * Parent and child relations exist only where the runtime reports them as events (P10.3). Nothing is inferred
 * from chat text. A runtime that exposes no children is reported as such, never as "no children".
 */
export type ChildCapability = 'observed' | 'none';
export const childCapability = (provider: string): ChildCapability => provider === 'claude' ? 'observed' : 'none';

export type ChildRecord = {
  childId: string; title: string | null; state: 'started' | 'completed' | 'failed' | 'missing'; result: string | null;
  /** Cost of the child. Null means unknown, never zero; a parent total that already includes children is not added to. */
  usage: null; source: string;
};

const ended = ['finished', 'failed', 'interrupted', 'unknown'];
export function childrenOf(db: Database.Database, runId: string): ChildRecord[] {
  const rows = db.prepare("SELECT payload FROM events WHERE run_id=? AND kind='child' ORDER BY seq").all(runId) as { payload: string }[];
  const byId = new Map<string, ChildRecord>();
  for (const row of rows) {
    const p = JSON.parse(row.payload); const body = p.payload ?? p;
    if (typeof body.childId !== 'string') continue;
    const old = byId.get(body.childId);
    byId.set(body.childId, { childId: body.childId, title: body.title ?? old?.title ?? null, state: body.state ?? old?.state ?? 'started',
      result: typeof body.result === 'string' ? body.result : old?.result ?? null, usage: null, source: body.source ?? old?.source ?? 'unknown' });
  }
  const state = (db.prepare('SELECT state FROM runs WHERE id=?').get(runId) as { state: string } | undefined)?.state ?? '';
  return [...byId.values()].map(child => child.state === 'started' && ended.includes(state) ? { ...child, state: 'missing' as const } : child);
}

export function childrenReport(db: Database.Database, taskId: string) {
  const runs = db.prepare('SELECT r.id,r.state,p.provider FROM runs r JOIN profiles p ON p.id=r.profile_id WHERE r.task_id=? ORDER BY r.created_at').all(taskId) as { id: string; state: string; provider: string }[];
  return runs.map(run => {
    const capability = childCapability(run.provider);
    return { runId: run.id, provider: run.provider, capability, partial: capability === 'none',
      note: capability === 'none' ? 'Questo runtime non espone figli osservabili: l’assenza di figli non è provata' : 'Figli rilevati solo dagli eventi del runtime',
      children: capability === 'observed' ? childrenOf(db, run.id) : [] };
  });
}

/** Results of finished children, kept short, for the Context Pack so they outlive the parent run. */
export function childResults(db: Database.Database, taskId: string) {
  const rows = db.prepare("SELECT DISTINCT run_id FROM events WHERE task_id=? AND kind='child' AND run_id IS NOT NULL").all(taskId) as { run_id: string }[];
  return rows.flatMap(row => childrenOf(db, row.run_id).map(child => ({ runId: row.run_id, childId: child.childId, title: child.title, state: child.state, result: child.result?.slice(0, 1000) ?? null })));
}

/** Individual stop is offered only where a runtime supports it. None does today, and that is stated, not hidden. */
export function stopChild() {
  return { stopped: false as const, reason: 'Il runtime non permette di arrestare un singolo figlio: arresta la run per fermarli tutti' };
}
