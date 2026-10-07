import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyFailure } from '../runtime/errors.js';
import { startAdapter, type AdapterEvent } from '../runtime/adapters.js';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { ProfileVerifier } from '../runtime/profiles.js';

/** Minimal JsonProcess double: the SDK worker is replaced, the adapter code under test is real. */
function fakeWorker(script: (message: any, emit: (value: any) => void) => void) {
  const worker: any = { onMessage: () => {}, onClose: () => {}, send(message: any) { queueMicrotask(() => script(message, value => worker.onMessage(value))); }, stop: async () => {} };
  return () => worker;
}
async function runQwen(provider: 'ollama' | 'openrouter', endpoint: string, script: Parameters<typeof fakeWorker>[0]) {
  const events: AdapterEvent[] = [];
  const home = mkdtempSync(join(tmpdir(), 'lagoto-fault-'));
  const adapter = await startAdapter({ profile: { id: crypto.randomUUID(), provider, model: 'm', name: 'n', endpoint, executable: null, capabilities: '{}' },
    cwd: home, directories: [home], home: join(home, 'h'), mode: 'agent', prompt: 'x', secret: provider === 'ollama' ? undefined : 'k'.repeat(12),
    onEvent: e => events.push(e), permission: async () => false, workerLauncher: fakeWorker(script) as any });
  return { adapter, events, outcome: adapter.completion.then(() => null, (error: Error) => error.message) };
}

describe('P00-I06 local and cloud failure matrix', () => {
  it('P00-I06 distinguishes server off, missing model, busy queue and denied network', () => {
    const causes = ['connect ECONNREFUSED 127.0.0.1:11434', 'model "qwen3.5:4b" not found, try pulling it first', 'server is busy, queue full (503)', 'connect EPERM 1.1.1.1:443 - Operation not permitted']
      .map(message => classifyFailure(message).cause);
    expect(causes).toEqual(['server_unavailable', 'model_missing', 'queue_busy', 'network_denied']);
    expect(new Set(causes).size).toBe(4);
  });
  it('P00-I06 surfaces a worker failure as an explicit adapter error instead of an empty success', async () => {
    const { outcome } = await runQwen('ollama', 'http://127.0.0.1:11434/v1', (message, emit) => { if (message.method === 'start') emit({ method: 'failure', params: { message: 'connect ECONNREFUSED 127.0.0.1:11434' } }); });
    const message = await outcome;
    expect(message).toContain('ECONNREFUSED');
    expect(classifyFailure(message).cause).toBe('server_unavailable');
  });
  it('P00-I06 refuses a non-loopback local endpoint and a cloud endpoint without HTTPS or key', async () => {
    const make = (provider: any, endpoint: string, secret?: string) => startAdapter({ profile: { id: 'x', provider, model: 'm', name: 'n', endpoint, executable: null, capabilities: '{}' },
      cwd: tmpdir(), directories: [tmpdir()], home: join(tmpdir(), 'lagoto-h'), mode: 'agent', prompt: 'x', secret, onEvent: () => {}, permission: async () => false });
    await expect(make('ollama', 'http://10.0.0.5:11434/v1')).rejects.toThrow('loopback');
    await expect(make('openrouter', 'http://openrouter.ai/api/v1', 'k'.repeat(12))).rejects.toThrow('HTTPS');
    await expect(make('openrouter', 'https://openrouter.ai/api/v1')).rejects.toThrow('Chiave');
  });
});

describe('P00-I03 capabilities are never simulated', () => {
  const stores: Store[] = [];
  afterEach(() => { for (const store of stores.splice(0)) { store.close(); rmSync(store.directory, { recursive: true, force: true }); } });
  async function verify(factory: any) {
    const store = new Store(mkdtempSync(join(tmpdir(), 'lagoto-cap-'))); stores.push(store);
    const service = new Service(store);
    const profile = await service.handle({ jsonrpc: '2.0', id: 1, method: 'profile/create', params: { name: 'P', provider: 'codex', model: 'm' } }) as any;
    const verifier = new ProfileVerifier(store, () => {}, factory, async () => ({ runtime: 'fake', version: '1', node: process.versions.node }));
    const check = verifier.start(profile.id);
    for (let i = 0; i < 60 && (store.db.prepare('SELECT state FROM profile_checks WHERE id=?').get(check.id) as any).state === 'checking'; i++) await new Promise(resolve => setTimeout(resolve, 50));
    const row = store.db.prepare('SELECT state,detail FROM profile_checks WHERE id=?').get(check.id) as any;
    const caps = JSON.parse((store.db.prepare('SELECT capabilities FROM profiles WHERE id=?').get(profile.id) as any).capabilities);
    return { row, caps };
  }
  it('P00-I03 a probe that never reads or writes through tools is failed, never verified', async () => {
    const { row, caps } = await verify(async () => ({ sessionId: 's', completion: Promise.resolve(), stop: async () => {} }));
    expect(row.state).toBe('failed'); expect(caps.verification).toBe('failed'); expect(caps.modes).toEqual([]);
  });
  it('P00-I03 a probe without credentials fails with the access error and registers no capability', async () => {
    const { row, caps } = await verify(async () => { throw Object.assign(new Error('Chiave API richiesta per questo endpoint'), { code: 401 }); });
    expect(row.state).toBe('failed'); expect(JSON.parse(row.detail).message).toContain('Chiave'); expect(caps.modes).toEqual([]);
  });
  it('P00-I03 a missing protocol method is classified as a failure, not an absent success', () => {
    expect(classifyFailure('Client capability not available (-32601)').cause).not.toBe('unknown');
  });
});
