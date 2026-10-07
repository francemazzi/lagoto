import { authStatus, type AuthProvider, type AuthState } from '../runtime/auth-status.js';
import { provenance, writeSmoke } from './evidence.js';

// Usage: pnpm probe:auth <ok|absent|expired|cancelled> [codex|claude|cursor ...]
// Records the state each CLI reports now. The file is `passed` only if every requested provider reports exactly the
// expected state, so a state is attested only when it was really observed (after a logout, an expiry or an abandoned login).
// Status commands consume no model quota and are not counted as real runs. Account identifiers are never stored.
const expected = process.argv[2] as AuthState;
if (!['ok', 'absent', 'expired', 'cancelled'].includes(expected)) throw new Error('Usage: pnpm probe:auth <ok|absent|expired|cancelled> [provider...]');
const requested = (process.argv.slice(3).length ? process.argv.slice(3) : ['codex', 'claude', 'cursor']) as AuthProvider[];
if (requested.some(provider => !['codex', 'claude', 'cursor'].includes(provider))) throw new Error('Provider sconosciuto');
const observed = await Promise.all(requested.map(provider => authStatus(provider)));
const matched = observed.every(result => result.state === expected);
const report = { ...provenance(), status: matched ? 'passed' : 'failed', expected, providers: observed, scope: 'Native login status read from the official CLIs; no credential, token or account identifier is stored.' };
const target = writeSmoke(`probe-auth-${expected}-${requested.join('+')}-${report.date.replaceAll(':', '-')}`, report);
console.log(JSON.stringify({ status: report.status, expected, providers: observed, evidence: target }, null, 2));
process.exitCode = matched ? 0 : 1;
