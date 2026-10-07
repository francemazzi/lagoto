import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Daily ledger of real agent starts on Francesco's accounts (Codex, Claude, Cursor, OpenRouter).
 * One entry per real adapter start. The cap is a product rule agreed on 6 October 2026 (10 per day);
 * raise it only for a day explicitly agreed, through LAGOTO_REAL_RUN_CAP.
 */
export const DEFAULT_REAL_RUN_CAP = 10;
export const CLOUD_PROVIDERS = new Set(['codex', 'claude', 'cursor', 'openrouter', 'qwen', 'kimi']);

export class RealRunCapError extends Error {
  constructor(readonly used: number, readonly cap: number, readonly requested: number) {
    super(`Tetto giornaliero di run reali raggiunto: ${used}/${cap} usate, richieste ${requested}. Imposta LAGOTO_REAL_RUN_CAP solo per una giornata concordata.`);
    this.name = 'RealRunCapError';
  }
}

type Ledger = { date: string; cap: number; entries: { at: string; label: string; count: number }[] };

export function todayKey(now = new Date(), timeZone = 'Europe/Rome') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function realRunCap(env = process.env) {
  const raw = env.LAGOTO_REAL_RUN_CAP;
  const cap = raw ? Number(raw) : DEFAULT_REAL_RUN_CAP;
  if (!Number.isInteger(cap) || cap < 0) throw new Error('LAGOTO_REAL_RUN_CAP deve essere un intero non negativo');
  return cap;
}

export function ledgerPath(directory = 'build/evidence/real-runs', date = todayKey()) {
  return join(directory, `${date}.json`);
}

export function readLedger(path: string, date: string, cap: number): Ledger {
  if (!existsSync(path)) return { date, cap, entries: [] };
  const ledger = JSON.parse(readFileSync(path, 'utf8')) as Ledger;
  return { date, cap, entries: Array.isArray(ledger.entries) ? ledger.entries : [] };
}

export function usedToday(ledger: Ledger) {
  return ledger.entries.reduce((sum, entry) => sum + entry.count, 0);
}

/** Record `count` real runs for `label`, or throw before any real process is started. */
export function consumeRealRun(label: string, count = 1, options: { directory?: string; now?: Date; env?: NodeJS.ProcessEnv } = {}) {
  const now = options.now ?? new Date();
  const date = todayKey(now);
  const cap = realRunCap(options.env);
  const path = ledgerPath(options.directory, date);
  const ledger = readLedger(path, date, cap);
  const used = usedToday(ledger);
  if (used + count > cap) throw new RealRunCapError(used, cap, count);
  ledger.entries.push({ at: now.toISOString(), label, count });
  mkdirSync(options.directory ?? 'build/evidence/real-runs', { recursive: true });
  writeFileSync(path, JSON.stringify(ledger, null, 2));
  return { used: used + count, cap, remaining: cap - used - count };
}

/** Local inference does not consume the accounts; cloud providers do. */
export function isRealRun(provider: string) {
  return CLOUD_PROVIDERS.has(provider);
}

export function realRunsSummary(options: { directory?: string; now?: Date; env?: NodeJS.ProcessEnv } = {}) {
  const date = todayKey(options.now ?? new Date());
  const cap = realRunCap(options.env);
  const ledger = readLedger(ledgerPath(options.directory, date), date, cap);
  return { date, cap, used: usedToday(ledger), entries: ledger.entries };
}
