import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authStatus, classifyAuth, classifyTool, assertAuthUsable, loadCompatibility } from '../runtime/auth-status.js';
import { executable } from '../runtime/process.js';
import { fromAdapterUsage, freshness, usageObservation } from '../runtime/usage.js';

function stub(body: string) {
  const dir = mkdtempSync(join(tmpdir(), 'lagoto-stub-')); const path = join(dir, 'tool');
  writeFileSync(path, `#!/bin/sh\n${body}\n`); chmodSync(path, 0o755); return path;
}

describe('P00-I01 inventory states', () => {
  it('P00-I01 distinguishes absent, valid, unrecognized and unproven tools', () => {
    const compatibility = loadCompatibility();
    expect(classifyTool('codex', { installed: false, version: null }, compatibility)).toBe('absent');
    expect(classifyTool('codex', { installed: true, version: null }, compatibility)).toBe('unrecognized');
    expect(classifyTool('codex', { installed: true, version: 'codex-cli 0.159.2' }, compatibility)).toBe('verified');
    expect(classifyTool('codex', { installed: true, version: 'codex-cli 9.9.9' }, compatibility)).toBe('unverified');
    expect(executable('definitely-not-installed-lagoto-tool')).toBeNull();
    expect(executable('sh', stub('echo hi'))).not.toBeNull();
  });
});

describe('P00-I02 native authentication states', () => {
  it('P00-I02 classifies absent, cancelled, expired and completed access for each provider', () => {
    expect(classifyAuth('codex', { exitCode: 0, stdout: 'Logged in using ChatGPT' }).state).toBe('ok');
    expect(classifyAuth('codex', { exitCode: 1, stdout: 'Not logged in' }).state).toBe('absent');
    expect(classifyAuth('claude', { exitCode: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }) }).state).toBe('ok');
    expect(classifyAuth('claude', { exitCode: 1, stdout: JSON.stringify({ loggedIn: false }) }).state).toBe('absent');
    expect(classifyAuth('cursor', { exitCode: 0, stdout: '✓ Logged in as someone' }).state).toBe('ok');
    expect(classifyAuth('cursor', { exitCode: 1, stdout: 'Not logged in' }).state).toBe('absent');
    expect(classifyAuth('cursor', { exitCode: 1, stdout: 'Your session has expired. Please log in again.' }).state).toBe('expired');
    expect(classifyAuth('codex', { exitCode: 130, stdout: '' }).state).toBe('cancelled');
    expect(classifyAuth('claude', { exitCode: 1, stdout: '', stderr: 'Login cancelled by user' }).state).toBe('cancelled');
    expect(classifyAuth('codex', { exitCode: 0, stdout: 'banner without status' }).state).toBe('unknown');
  });
  it('P00-I02 never returns account identifiers or tokens and refuses to start with an unusable login', async () => {
    const result = await authStatus('cursor', stub('echo "Logged in as person@example.com token sk-abcdefghijklmnopqrstuvwxyz"'));
    expect(result.state).toBe('ok');
    expect(JSON.stringify(result)).not.toMatch(/person@example|sk-abc/);
    for (const state of ['absent', 'expired', 'cancelled', 'unknown'] as const) expect(() => assertAuthUsable({ provider: 'codex', state, detail: 'x' })).toThrow();
    expect(() => assertAuthUsable({ provider: 'codex', state: 'ok', detail: 'x' })).not.toThrow();
    expect((await authStatus('codex', stub('echo "Not logged in"; exit 1'))).state).toBe('absent');
  });
});

describe('P00-I03 capability honesty', () => {
  it('P00-I03 treats an unknown auth output as not usable and a missing binary as absent', async () => {
    expect((await authStatus('claude', stub('echo hello'))).state).toBe('unknown');
    expect(() => assertAuthUsable({ provider: 'claude', state: 'unknown', detail: '' })).toThrow();
  });
});

describe('P00-I08 usage contract', () => {
  it('P00-I08 keeps measured, manual, estimated, missing and stale distinct and never turns missing into zero', () => {
    const now = new Date('2026-10-07T10:00:00Z');
    const measured = fromAdapterUsage({ usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1 } }, 'claude', now.toISOString());
    expect(measured).toMatchObject({ source: 'measured', value: 16, metric: 'billed_tokens_cumulative' });
    const missing = fromAdapterUsage({ nothing: true }, 'cursor', now.toISOString());
    expect(missing).toMatchObject({ source: 'missing', value: null });
    expect(usageObservation.safeParse(missing).success).toBe(true);
    expect(usageObservation.safeParse({ ...missing, value: 0 }).success).toBe(false);
    expect(usageObservation.safeParse({ ...measured, value: null }).success).toBe(false);
    expect(freshness(measured, new Date('2026-10-07T10:20:00Z')).source).toBe('stale');
    expect(freshness(measured, new Date('2026-10-07T10:05:00Z')).source).toBe('measured');
    expect(freshness({ ...measured, source: 'manual' }, new Date('2027-01-01T00:00:00Z')).source).toBe('manual');
  });
});

import { afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { RunManager } from '../runtime/runs.js';
import { startAdapter } from '../runtime/adapters.js';

describe('P00-I02 run start gate', () => {
  const stores: Store[] = [];
  afterEach(() => { for (const store of stores.splice(0)) { store.close(); rmSync(store.directory, { recursive: true, force: true }); } });
  it('P00-I02 rejects a run when the native login is expired, before any process starts', async () => {
    const store = new Store(mkdtempSync(join(tmpdir(), 'lagoto-auth-'))); stores.push(store);
    const service = new Service(store);
    const call = (method: string, params: Record<string, unknown>) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
    const project = await call('project/create', { name: 'Auth gate' });
    const task = await call('task/create', { projectId: project.id, title: 'T' });
    const profile = await call('profile/create', { name: 'Claude', provider: 'claude', model: 'sonnet' });
    store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run(JSON.stringify({ modes: ['agent'], efforts: [], verification: 'passed' }), profile.id);
    const runs = new RunManager(store, () => {}, startAdapter, async provider => ({ provider, state: 'expired', detail: 'Sessione scaduta' }));
    await expect(runs.start(task.id, profile.id, 'x', crypto.randomUUID(), 'agent')).rejects.toThrow(/non utilizzabile/);
    expect(store.db.prepare('SELECT count(*) AS count FROM runs').get()).toEqual({ count: 0 });
    expect(await call('integration/list', {})).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'git', state: expect.any(String) })]));
  });
});

import { mkdirSync } from 'node:fs';
import { inspectBundle } from '../scripts/package-checks.js';
describe('P00-I05 distributed bundle has no automation or test endpoint', () => {
  function bundle(executableText: string, extra: string[] = []) {
    const app = mkdtempSync(join(tmpdir(), 'lagoto-bundle-')) + '/Lagoto.app';
    for (const dir of ['Contents/MacOS', 'Contents/Resources/runtime']) mkdirSync(join(app, dir), { recursive: true });
    writeFileSync(join(app, 'Contents/MacOS/Lagoto'), executableText);
    for (const file of ['Contents/Resources/runtime/node', 'Contents/Resources/build-provenance.json', 'Contents/Resources/LICENSE']) writeFileSync(join(app, file), 'x');
    for (const name of extra) { mkdirSync(join(app, 'Contents/PlugIns', name), { recursive: true }); }
    return app;
  }
  it('P00-I05 accepts a clean release bundle and rejects test bundles and compiled test overrides', () => {
    expect(inspectBundle(bundle('native code')).every(check => check.ok)).toBe(true);
    expect(inspectBundle(bundle('uses LAGOTO_TEST_DATA_DIR')).find(check => check.name === 'no-data-dir-override-in-native-executable')?.ok).toBe(false);
    // The app legitimately passes the chosen archive to its runtime child under the product name; only the test-only name is forbidden.
    expect(inspectBundle(bundle('sets LAGOTO_DATA_DIR for the child')).find(check => check.name === 'no-data-dir-override-in-native-executable')?.ok).toBe(true);
    expect(inspectBundle(bundle('-LagotoWindowSize')).find(check => check.name === 'no-window-size-override-in-native-executable')?.ok).toBe(false);
    expect(inspectBundle(bundle('ok', ['LagotoUITests.xctest'])).find(check => check.name === 'no-test-bundles')?.ok).toBe(false);
  });
});
