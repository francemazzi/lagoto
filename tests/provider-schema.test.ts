import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { RunManager } from '../runtime/runs.js';
import { startAdapter, claudeNormalizer, type AdapterEvent } from '../runtime/adapters.js';
import { qwenNormalizer } from '../runtime/qwen-normalizer.js';
import { runtimeIdentity } from '../runtime/runtime-identity.js';

const roots: string[] = []; const stores: Store[] = [];
afterEach(() => { for (const s of stores.splice(0)) { try { s.close(); } catch { /* closed */ } } for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
const temp = () => { const p = mkdtempSync(join(tmpdir(), 'lagoto-schema-')); roots.push(p); return p; };

/** A stand-in `codex` executable: scripted answers to --version, login status and the app-server protocol. */
function fakeCodex(options: { version: string; initialize?: 'ok' | 'error'; threadStart?: 'ok' | 'empty' }) {
  const path = join(temp(), 'codex');
  writeFileSync(path, `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('codex-cli ${options.version}'); process.exit(0); }
if (args[0] === 'login') { console.log('Logged in using ChatGPT'); process.exit(0); }
let buffer = '';
process.stdin.on('data', chunk => { buffer += chunk; let i; while ((i = buffer.indexOf('\\n')) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); if (!line) continue; const message = JSON.parse(line);
  if (message.method === 'initialize') { console.log(JSON.stringify(${options.initialize === 'error' ? `{ id: message.id, error: { code: -32602, message: 'schema mismatch: unsupported clientInfo' } }` : `{ id: message.id, result: {} }`})); }
  else if (message.method === 'thread/start') { console.log(JSON.stringify(${options.threadStart === 'empty' ? '{ id: message.id, result: {} }' : '{ id: message.id, result: { thread: { id: "t1" } } }'})); }
  else if (message.method === 'turn/start') { console.log(JSON.stringify({ id: message.id, result: { turn: { id: 'u1' } } })); }
  else if (message.id !== undefined) console.log(JSON.stringify({ id: message.id, result: {} })); } });
process.stdin.on('end', () => process.exit(0));
`);
  chmodSync(path, 0o755); return path;
}
const profileFor = (executable: string) => ({ id: crypto.randomUUID(), provider: 'codex' as const, model: 'm', name: 'n', endpoint: null, executable, capabilities: '{}' });
const baseOptions = (executable: string, events: AdapterEvent[] = []) => { const cwd = temp(); return { profile: profileFor(executable), cwd, directories: [cwd], home: join(cwd, 'h'), mode: 'agent' as const, prompt: 'x', onEvent: (e: AdapterEvent) => events.push(e), permission: async () => false }; };

describe('P12-I05 incompatible provider schemas are detected, never turned into success', () => {
  it('P12-I05 a provider that rejects the handshake fails explicitly with its own message', async () => {
    await expect(startAdapter(baseOptions(fakeCodex({ version: '9.9.9', initialize: 'error' })))).rejects.toThrow('schema mismatch');
  });
  it('P12-I05 a provider that answers without the expected thread is rejected and never reports an empty success', async () => {
    const events: AdapterEvent[] = [];
    await expect(startAdapter(baseOptions(fakeCodex({ version: '9.9.9', threadStart: 'empty' }), events))).rejects.toThrow();
    expect(events.some(event => event.kind === 'result')).toBe(false);
  });
  it('P12-I05 a changed runtime version blocks the run until the profile is verified again, and a login that is not usable blocks it first', async () => {
    const store = new Store(join(temp(), 'data')); stores.push(store); const service = new Service(store);
    const call = (method: string, params: Record<string, unknown> = {}) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
    const project = await call('project/create', { name: 'S' }); const task = await call('task/create', { projectId: project.id, title: 'T' });
    const verified = fakeCodex({ version: '1.0.0' });
    const profile = await call('profile/create', { name: 'C', provider: 'codex', model: 'm', executable: verified });
    const identity = await runtimeIdentity({ ...profileFor(verified), id: profile.id });
    store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run(JSON.stringify({ modes: ['agent'], efforts: [], verification: 'passed', proof: { identity, model: 'm', endpoint: null } }), profile.id);
    store.db.prepare('INSERT INTO repositories(id,project_id,name,path) VALUES(?,?,?,?)').run('11111111-1111-4111-8111-111111111111', project.id, 'r', temp());
    store.db.prepare('INSERT INTO task_repositories(task_id,repository_id,path,branch,base) VALUES(?,?,?,?,?)').run(task.id, '11111111-1111-4111-8111-111111111111', temp(), 'main', 'HEAD');
    const upgraded = fakeCodex({ version: '2.0.0' });
    store.db.prepare('UPDATE profiles SET executable=? WHERE id=?').run(upgraded, profile.id);
    const runs = new RunManager(store, () => {}, startAdapter);
    await expect(runs.start(task.id, profile.id, 'x', crypto.randomUUID(), 'agent')).rejects.toThrow('Runtime o versione cambiati');
    expect((store.db.prepare('SELECT count(*) AS count FROM runs').get() as any).count).toBe(0);
    const expired = new RunManager(store, () => {}, startAdapter, async provider => ({ provider, state: 'expired', detail: 'Sessione scaduta' }));
    await expect(expired.start(task.id, profile.id, 'x', crypto.randomUUID(), 'agent')).rejects.toThrow('non utilizzabile');
  });
  it('P12-I05 unknown events from Claude and Qwen are kept raw and never crash or fabricate content', () => {
    const claude = claudeNormalizer();
    const events = claude({ type: 'future_message_kind', payload: { surprise: true } } as any);
    expect(events.map(event => event.kind)).toEqual(['raw']);
    expect(claude({ type: 'result', is_error: true, result: 'boom' } as any).some(event => event.kind === 'error')).toBe(true);
    const qwen = qwenNormalizer();
    expect(qwen({ type: 'brand_new_event', data: 1 } as any).every(event => event.kind === 'raw')).toBe(true);
  });
});
