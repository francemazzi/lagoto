import type Database from 'better-sqlite3';
import { contextPack } from './checkpoint.js';
import type { Store } from './storage.js';

/**
 * Three quantities that must never be confused (P09.3):
 *  - occupancy: tokens currently in the model context, only when the provider reports them per request;
 *  - package: Lagoto's own estimate of the Context Pack it would hand to a successor;
 *  - checkpoint: when the task state was last saved.
 * Cumulative billed tokens are accounting data and are never shown as occupancy.
 */
export type Occupancy = { used: number | null; window: number | null; source: 'measured' | 'missing'; basis: string };

const total = (u: any) => Number.isSafeInteger(u?.totalTokens) ? u.totalTokens as number : null;

/** Occupancy from one provider usage payload. Only fields that denote the last request are accepted. */
export function occupancyFromUsage(payload: any): Occupancy {
  const raw = payload?.payload ?? payload ?? {};
  // Codex app-server: tokenUsage.last is the last request, modelContextWindow the model window.
  const codex = raw.tokenUsage;
  if (codex?.last) {
    const used = total(codex.last);
    const window = Number.isSafeInteger(codex.modelContextWindow) ? codex.modelContextWindow as number : null;
    if (used !== null) return { used, window, source: 'measured', basis: 'codex:last-request' };
  }
  // Claude Code: the last iteration is the last request; its inputs plus output are the context after it.
  const iterations = raw.usage?.iterations;
  if (Array.isArray(iterations) && iterations.length) {
    const last = iterations[iterations.length - 1];
    const parts = [last.input_tokens, last.cache_read_input_tokens, last.cache_creation_input_tokens, last.output_tokens];
    if (parts.every(value => Number.isSafeInteger(value))) return { used: (parts as number[]).reduce((a, b) => a + b, 0), window: null, source: 'measured', basis: 'claude:last-iteration' };
  }
  return { used: null, window: null, source: 'missing', basis: 'cumulative-or-absent' };
}

/** A drop of more than a fifth between consecutive measurements is reported as an observed compaction, not an error. */
export function compactionObserved(history: number[]): boolean {
  for (let i = 1; i < history.length; i++) if (history[i - 1]! > 0 && history[i]! < history[i - 1]! * 0.8) return true;
  return false;
}

export function runOccupancy(db: Database.Database, runId: string) {
  const rows = db.prepare("SELECT payload FROM events WHERE run_id=? AND kind='usage' ORDER BY seq").all(runId) as { payload: string }[];
  const measured = rows.map(row => occupancyFromUsage(JSON.parse(row.payload))).filter(entry => entry.source === 'measured');
  const latest = measured.at(-1) ?? { used: null, window: null, source: 'missing' as const, basis: 'cumulative-or-absent' };
  return { ...latest, compacted: compactionObserved(measured.map(entry => entry.used!)), measurements: measured.length };
}

export function contextMeter(store: Store, taskId: string, windowOverride?: number) {
  store.task(taskId);
  const run = store.db.prepare("SELECT id FROM runs WHERE task_id=? ORDER BY created_at DESC LIMIT 1").get(taskId) as { id: string } | undefined;
  const occupancy = run ? runOccupancy(store.db, run.id) : { used: null, window: null, source: 'missing' as const, basis: 'no-run', compacted: false, measurements: 0 };
  const pack = contextPack(store, taskId, 48000).content;
  const checkpoint = store.db.prepare('SELECT created_at FROM checkpoints WHERE task_id=? ORDER BY created_at DESC LIMIT 1').get(taskId) as { created_at: string } | undefined;
  const window = occupancy.window ?? windowOverride ?? null;
  return {
    occupancy: { ...occupancy, window, fraction: occupancy.used !== null && window ? Math.min(1, occupancy.used / window) : null },
    package: { estimatedTokens: Math.ceil(pack.length / 4), source: 'estimated' as const, basis: 'characters/4' },
    checkpoint: { savedAt: checkpoint?.created_at ?? null },
  };
}
