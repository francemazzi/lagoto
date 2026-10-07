import { tmpdir } from 'node:os';
import { codexClient } from './adapters.js';
import { classifyFailure } from './errors.js';
import { authStatus, type AuthProvider } from './auth-status.js';
import { freshness, usageObservation, type UsageObservation } from './usage.js';

/** Outcome of reading provider usage. Every state is distinct and none of them blocks task recovery (P09.1). */
export type UsageRead = {
  provider: string;
  state: 'measured' | 'unsupported' | 'auth' | 'network' | 'failed';
  observations: UsageObservation[];
  plan: string | null;
  limitReached: boolean;
  detail: string;
};

const missing = (provider: string, observedAt: string): UsageObservation => ({ source: 'missing', metric: 'account_quota_percent', unit: 'percent', scope: 'account', value: null,
  window: { kind: 'none', seconds: null, resetsAt: null }, observedAt, origin: `${provider}:no-documented-source` });

/** Parse `account/rateLimits/read` of the Codex app-server. The account identifier in the response is never copied. */
export function parseCodexRateLimits(result: any, observedAt = new Date().toISOString()): Pick<UsageRead, 'observations' | 'plan' | 'limitReached'> {
  const observations: UsageObservation[] = [];
  const buckets: Record<string, any> = result?.rateLimitsByLimitId ?? (result?.rateLimits ? { [result.rateLimits.limitId ?? 'codex']: result.rateLimits } : {});
  for (const [id, bucket] of Object.entries(buckets)) {
    for (const slot of ['primary', 'secondary'] as const) {
      const window = bucket?.[slot];
      if (!window || typeof window.usedPercent !== 'number') continue;
      const candidate = {
        source: 'measured' as const, metric: 'account_quota_percent' as const, unit: 'percent' as const, scope: 'account' as const,
        value: Math.max(0, window.usedPercent),
        window: { kind: 'fixed' as const, seconds: Number.isInteger(window.windowDurationMins) && window.windowDurationMins > 0 ? window.windowDurationMins * 60 : null,
          resetsAt: Number.isFinite(window.resetsAt) ? new Date(window.resetsAt * 1000).toISOString() : null },
        observedAt, origin: `codex:${String(id).slice(0, 40)}:${slot}`,
      };
      const parsed = usageObservation.safeParse(candidate);
      if (parsed.success) observations.push(parsed.data);
    }
  }
  const first = Object.values(buckets)[0] as any;
  return { observations, plan: typeof first?.planType === 'string' ? first.planType : null,
    limitReached: Boolean(first?.rateLimitReachedType) || first?.spendControlReached === true };
}

export type CodexReader = () => Promise<any>;
const readCodex: CodexReader = async () => {
  const client = await codexClient(tmpdir());
  try { return await client.request('account/rateLimits/read', {}); } finally { await client.stop(); }
};

export async function readUsage(provider: string, deps: { codex?: CodexReader; auth?: typeof authStatus; now?: Date } = {}): Promise<UsageRead> {
  const now = deps.now ?? new Date(); const observedAt = now.toISOString();
  if (provider !== 'codex') {
    return { provider, state: 'unsupported', observations: [missing(provider, observedAt)], plan: null, limitReached: false,
      detail: 'Nessuna fonte di quota documentata: la quota resta non disponibile e la batteria usa il budget personale' };
  }
  const login = await (deps.auth ?? authStatus)('codex' as AuthProvider);
  if (login.state !== 'ok') return { provider, state: 'auth', observations: [missing(provider, observedAt)], plan: null, limitReached: false, detail: `Accesso ${login.state}: nessuna quota letta` };
  try {
    const parsed = parseCodexRateLimits(await (deps.codex ?? readCodex)(), observedAt);
    if (!parsed.observations.length) return { provider, state: 'unsupported', observations: [missing(provider, observedAt)], plan: parsed.plan, limitReached: parsed.limitReached, detail: 'Il provider non ha riportato finestre di quota' };
    return { provider, state: 'measured', ...parsed, detail: 'Quota account letta dal provider' };
  } catch (error) {
    const failure = classifyFailure(error instanceof Error ? error.message : String(error));
    const network = ['network', 'network_denied', 'server_unavailable'].includes(failure.cause);
    return { provider, state: network ? 'network' : failure.cause === 'auth' ? 'auth' : 'failed', observations: [missing(provider, observedAt)], plan: null, limitReached: false, detail: failure.action };
  }
}

/** Observations older than the freshness window are downgraded to stale before they are shown or stored. */
export function withFreshness(read: UsageRead, now = new Date()): UsageRead {
  return { ...read, observations: read.observations.map(observation => freshness(observation, now)) };
}
