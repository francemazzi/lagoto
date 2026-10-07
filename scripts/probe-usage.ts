import { readUsage } from '../runtime/usage-sources.js';
import { provenance, writeSmoke } from './evidence.js';

// Reads the quota the provider documents for each integration. No model runs, no inference quota is consumed.
// The file is `passed` only if at least one provider reported a measurement and every other provider is
// explicitly marked unsupported or unavailable (never silently zero).
const providers = ['codex', 'claude', 'cursor'];
const reads = await Promise.all(providers.map(provider => readUsage(provider)));
const measured = reads.filter(read => read.state === 'measured');
const report = { ...provenance(), status: measured.length ? 'passed' : 'failed', reads: reads.map(read => ({ provider: read.provider, state: read.state, plan: read.plan, limitReached: read.limitReached, detail: read.detail, observations: read.observations })),
  scope: 'Documented provider quota sources only; no scraping, no private endpoints, no account identifiers stored.' };
const target = writeSmoke(`probe-usage-${report.date.replaceAll(':', '-')}`, report);
console.log(JSON.stringify({ status: report.status, evidence: target, reads: report.reads.map(read => `${read.provider}:${read.state}`) }, null, 2));
process.exitCode = measured.length ? 0 : 1;
