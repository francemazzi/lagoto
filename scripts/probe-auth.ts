import { execFile, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authStatus, classifyAuth, authCommands, type AuthProvider, type AuthState, type StatusRunner } from '../runtime/auth-status.js';
import { cleanEnvironment, executable } from '../runtime/process.js';
import { provenance, writeSmoke } from './evidence.js';

// Usage: pnpm probe:auth <ok|absent|expired|cancelled> [codex|claude|cursor ...]
// Records the state each CLI reports now. The file is `passed` only if every requested provider reports exactly the
// expected state, so a state is attested only when it was really observed (after a logout, an expiry or an abandoned login).
// Status commands consume no model quota and are not counted as real runs. Account identifiers are never stored.
const expected = process.argv[2] as AuthState;
if (!['ok', 'absent', 'expired', 'cancelled'].includes(expected)) throw new Error('Usage: pnpm probe:auth <ok|absent|expired|cancelled> [provider...]');
const requested = (process.argv.slice(3).filter(a => !a.startsWith('--')).length ? process.argv.slice(3).filter(a => !a.startsWith('--')) : ['codex', 'claude', 'cursor']) as AuthProvider[];
if (requested.some(provider => !['codex', 'claude', 'cursor'].includes(provider))) throw new Error('Provider sconosciuto');
// `--isolated` reads the state from a brand-new empty home, so "absent" and "cancelled" are observed on a machine that
// never signed in, without logging out of (or touching) the real accounts. `ok` and `expired` are only ever read from the real state.
const isolated = process.argv.includes('--isolated');
const home = isolated ? mkdtempSync(join(tmpdir(), 'lagoto-auth-')) : null;
const env = (): Record<string, string> => ({ ...cleanEnvironment({ BROWSER: '/usr/bin/true' }), ...(home ? { HOME: home } : {}) });
const isolatedRun: StatusRunner = (path, args) => new Promise(resolve => execFile(path, args, { env: env(), timeout: 20000, maxBuffer: 1024 * 1024 }, (error: any, stdout, stderr) =>
  resolve({ exitCode: error ? (typeof error.code === 'number' ? error.code : null) : 0, stdout: String(stdout), stderr: String(stderr) })));
const loginCommands: Record<AuthProvider, string[]> = { codex: ['login'], claude: ['auth', 'login'], cursor: ['login'] };
// An abandoned login: start the official login flow in the isolated home and interrupt it before anything is typed or approved.
const cancelledRun = (provider: AuthProvider): Promise<AuthState> => new Promise(resolve => {
  const path = executable(authCommands[provider].binary);
  if (!path) return resolve('absent');
  const child = spawn(path, loginCommands[provider], { env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { out += chunk; });
  let interrupted = false;
  setTimeout(() => { interrupted = true; child.kill('SIGINT'); }, 4000);
  setTimeout(() => child.kill('SIGKILL'), 8000).unref();
  child.on('close', (code, signal) => resolve(classifyAuth(provider, { exitCode: interrupted && !/logged in as|login successful|successfully/i.test(out) ? 130 : code ?? (signal ? 130 : null), stdout: out }).state));
});
const observed = await Promise.all(requested.map(async provider => expected === 'cancelled' && isolated
  ? { provider, state: await cancelledRun(provider), detail: 'Accesso annullato prima del completamento (home isolata)' }
  : authStatus(provider, null, isolated ? isolatedRun : undefined)));
const matched = observed.every(result => result.state === expected);
const report = { ...provenance(), status: matched ? 'passed' : 'failed', expected, isolatedHome: isolated, providers: observed, scope: 'Native login status read from the official CLIs; no credential, token or account identifier is stored.' };
const target = writeSmoke(`probe-auth-${expected}-${requested.join('+')}-${report.date.replaceAll(':', '-')}`, report);
console.log(JSON.stringify({ status: report.status, expected, providers: observed, evidence: target }, null, 2));
process.exitCode = matched ? 0 : 1;
