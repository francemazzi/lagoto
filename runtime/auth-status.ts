import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { executable, cleanEnvironment } from './process.js';
import { redact } from './protocol.js';

const execute = promisify(execFile);

/** ok: usable login. absent: never signed in. expired: session needs renewal. cancelled: a login flow was abandoned. unknown: output not understood (never treated as ok). */
export type AuthState = 'ok' | 'absent' | 'expired' | 'cancelled' | 'unknown';
export type AuthResult = { provider: string; state: AuthState; detail: string };
export type AuthProvider = 'codex' | 'claude' | 'cursor';

export const authCommands: Record<AuthProvider, { binary: string; args: string[] }> = {
  codex: { binary: 'codex', args: ['login', 'status'] },
  claude: { binary: 'claude', args: ['auth', 'status'] },
  cursor: { binary: 'cursor-agent', args: ['status'] },
};

/** Classify the raw outcome of a status or login command. Account identifiers are never returned. */
export function classifyAuth(provider: AuthProvider, outcome: { exitCode: number | null; stdout: string; stderr?: string }): AuthResult {
  const text = `${outcome.stdout}\n${outcome.stderr ?? ''}`;
  const result = (state: AuthState, detail: string): AuthResult => ({ provider, state, detail });
  if (outcome.exitCode === 130 || /cancel(l)?ed|aborted by user/i.test(text)) return result('cancelled', 'Accesso annullato');
  if (/expired|session has expired|token.*(invalid|revoked)|re-?authenticate|please log in again/i.test(text)) return result('expired', 'Sessione scaduta');
  if (provider === 'claude') {
    try {
      const value = JSON.parse(outcome.stdout);
      if (value.loggedIn === true) return result('ok', `Accesso ${value.authMethod ?? 'nativo'}`);
      if (value.loggedIn === false) return result('absent', 'Nessun accesso');
    } catch { /* not JSON: fall through to text rules */ }
  }
  if (/not logged in|no (active )?(login|account|session)|logged out|please log in|not authenticated/i.test(text)) return result('absent', 'Nessun accesso');
  if (outcome.exitCode === 0 && /logged in|authenticated/i.test(text)) return result('ok', 'Accesso nativo attivo');
  return result('unknown', 'Stato di accesso non riconosciuto');
}

export type StatusRunner = (path: string, args: string[]) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
const runStatus: StatusRunner = async (path, args) => {
  try {
    const { stdout, stderr } = await execute(path, args, { env: cleanEnvironment(), timeout: 20000, maxBuffer: 1024 * 1024 });
    return { exitCode: 0, stdout, stderr };
  } catch (error: any) {
    return { exitCode: typeof error.code === 'number' ? error.code : null, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? error.message ?? '') };
  }
};

/** Read the native login state without starting a login or touching credentials. */
export async function authStatus(provider: AuthProvider, configured?: string | null, run: StatusRunner = runStatus): Promise<AuthResult> {
  const command = authCommands[provider];
  const path = executable(command.binary, configured);
  if (!path) return { provider, state: 'absent', detail: 'Strumento non installato' };
  const outcome = await run(path, command.args);
  const result = classifyAuth(provider, outcome);
  return { ...result, detail: String(redact(result.detail)) };
}

/** A run may start only with a usable login; unknown never counts as ok. */
export function assertAuthUsable(result: AuthResult) {
  if (result.state === 'ok') return;
  throw Object.assign(new Error(`Accesso ${result.provider} non utilizzabile: ${result.detail}`), { code: result.state === 'expired' ? 401 : 409 });
}

export type ToolState = 'absent' | 'verified' | 'unrecognized' | 'unverified';
type Compatibility = { tools: Record<string, { verified: string[]; kind: string }> };
export function loadCompatibility(path = new URL('./compatibility.json', import.meta.url)): Compatibility {
  return JSON.parse(readFileSync(path, 'utf8')) as Compatibility;
}

/** absent: no binary. unrecognized: binary present but no readable version. verified: version listed as proven. unverified: readable but not proven. */
export function classifyTool(name: string, entry: { installed: boolean; version: string | null }, compatibility = loadCompatibility()): ToolState {
  if (!entry.installed) return 'absent';
  if (!entry.version) return 'unrecognized';
  const proven = compatibility.tools[name]?.verified ?? [];
  return proven.some(version => entry.version!.includes(version)) ? 'verified' : 'unverified';
}
