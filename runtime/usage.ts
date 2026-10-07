import { z } from 'zod';

/**
 * Contract for usage measurements (P00.8). A value is never silently zero: missing, stale and manual
 * measurements are distinct sources. Cumulative billed tokens, current context occupancy and account
 * quota are different quantities and are never converted into one another.
 */
export const usageSource = z.enum(['measured', 'manual', 'estimated', 'missing', 'stale']);
export const usageMetric = z.enum(['billed_tokens_cumulative', 'context_occupancy', 'account_quota_percent', 'account_quota_units']);
export const usageObservation = z.object({
  source: usageSource,
  metric: usageMetric,
  unit: z.enum(['tokens', 'percent', 'requests', 'credits']),
  scope: z.enum(['run', 'session', 'account', 'product']),
  value: z.number().nonnegative().nullable(),
  window: z.object({ kind: z.enum(['rolling', 'fixed', 'cycle', 'none']), seconds: z.number().int().positive().nullable(), resetsAt: z.string().datetime().nullable() }),
  observedAt: z.string().datetime(),
  origin: z.string().min(1).max(100),
}).strict().refine(value => (value.source === 'missing') === (value.value === null), { message: 'value è null se e solo se la sorgente è missing' });
export type UsageObservation = z.infer<typeof usageObservation>;

export const STALE_AFTER_SECONDS = 15 * 60;

/** Downgrade an old measurement to stale instead of presenting it as current. */
export function freshness(observation: UsageObservation, now = new Date()): UsageObservation {
  if (observation.source !== 'measured') return observation;
  const age = (now.getTime() - Date.parse(observation.observedAt)) / 1000;
  return age > STALE_AFTER_SECONDS ? { ...observation, source: 'stale' } : observation;
}

/** Observation derived from an adapter `usage` event; Cursor and other adapters without usage yield missing. */
export function fromAdapterUsage(payload: any, runtime: string, observedAt = new Date().toISOString()): UsageObservation {
  const raw = payload?.payload ?? payload ?? {};
  const u = raw.tokenUsage?.total ?? raw.usage ?? raw;
  const total = u?.totalTokens ?? u?.total_tokens ?? (typeof u?.input_tokens === 'number' && typeof u?.output_tokens === 'number'
    ? u.input_tokens + u.output_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : undefined);
  const base = { metric: 'billed_tokens_cumulative' as const, unit: 'tokens' as const, scope: 'session' as const, window: { kind: 'none' as const, seconds: null, resetsAt: null }, observedAt, origin: runtime };
  return Number.isSafeInteger(total) && total >= 0 ? { ...base, source: 'measured', value: total } : { ...base, source: 'missing', value: null };
}
