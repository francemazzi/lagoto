import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { compactionObserved, occupancyFromUsage } from '../runtime/context-meter.js';

const stores: Store[] = [];
afterEach(() => { for (const s of stores.splice(0)) { s.close(); rmSync(s.directory, { recursive: true, force: true }); } });

// Shapes taken from real provider events recorded on 5 October 2026 (values synthetic and rounded).
const codexUsage = { threadId: 't', tokenUsage: { total: { totalTokens: 90000, inputTokens: 89000, outputTokens: 1000 }, last: { totalTokens: 26621, inputTokens: 26554, outputTokens: 67 }, modelContextWindow: 258400 } };
const claudeUsage = { usage: { input_tokens: 6, cache_creation_input_tokens: 5599, cache_read_input_tokens: 74235, output_tokens: 545, iterations: [{ input_tokens: 2, output_tokens: 11, cache_read_input_tokens: 26682, cache_creation_input_tokens: 327 }] } };
const qwenUsage = { usage: { input_tokens: 85499, output_tokens: 775, cache_read_input_tokens: 63031, total_tokens: 86274 }, scope: 'session', source: 'runtime-estimate' };

describe('P09-I03 context occupancy is not cumulative usage', () => {
  it('P09-I03 reads occupancy only from per-request fields and reports the rest as missing', () => {
    expect(occupancyFromUsage(codexUsage)).toEqual({ used: 26621, window: 258400, source: 'measured', basis: 'codex:last-request' });
    expect(occupancyFromUsage({ payload: claudeUsage })).toMatchObject({ used: 2 + 26682 + 327 + 11, window: null, source: 'measured' });
    const cumulative = occupancyFromUsage(qwenUsage);
    expect(cumulative).toMatchObject({ used: null, source: 'missing' });
    expect(occupancyFromUsage({})).toMatchObject({ used: null, source: 'missing' });
  });
  it('P09-I03 a decrease between measurements is reported as an observed compaction', () => {
    expect(compactionObserved([100, 120, 140])).toBe(false);
    expect(compactionObserved([100, 120, 60])).toBe(true);
    expect(compactionObserved([])).toBe(false);
  });
  it('P09-I03 the meter keeps occupancy, package estimate and checkpoint apart and never turns cumulative tokens into occupancy', async () => {
    const store = new Store(mkdtempSync(join(tmpdir(), 'lagoto-meter-'))); stores.push(store); const service = new Service(store);
    const call = (method: string, params: Record<string, unknown> = {}) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
    const project = await call('project/create', { name: 'M' }); const task = await call('task/create', { projectId: project.id, title: 'T' });
    const profile = await call('profile/create', { name: 'P', provider: 'codex', model: 'm' });
    expect((await call('context/meter', { taskId: task.id })).occupancy).toMatchObject({ source: 'missing', used: null, fraction: null });
    const run = crypto.randomUUID();
    store.db.prepare('INSERT INTO runs(id,task_id,profile_id,state,model,created_at) VALUES(?,?,?,?,?,?)').run(run, task.id, profile.id, 'finished', 'm', new Date().toISOString());
    store.event(task.id, run, 'usage', { kind: 'usage', payload: qwenUsage });
    const unmeasured = await call('context/meter', { taskId: task.id });
    expect(unmeasured.occupancy).toMatchObject({ source: 'missing', used: null });
    expect(unmeasured.package).toMatchObject({ source: 'estimated' });
    expect(unmeasured.checkpoint.savedAt).toBeNull();
    store.event(task.id, run, 'usage', { kind: 'usage', payload: codexUsage });
    const measured = await call('context/meter', { taskId: task.id });
    expect(measured.occupancy).toMatchObject({ source: 'measured', used: 26621, window: 258400, compacted: false });
    expect(measured.occupancy.fraction).toBeCloseTo(26621 / 258400, 5);
  });
});

import { parseCodexRateLimits, readUsage, withFreshness } from '../runtime/usage-sources.js';
const realShape = { ordinaryUsageAllowed: true, rateLimits: { limitId: 'codex', primary: { usedPercent: 12.5, windowDurationMins: 10080, resetsAt: 1792001571 }, secondary: null, planType: 'plus', rateLimitReachedType: null, spendControlReached: false },
  rateLimitsByLimitId: { codex: { limitId: 'codex', primary: { usedPercent: 12.5, windowDurationMins: 10080, resetsAt: 1792001571 }, secondary: null, planType: 'plus', rateLimitReachedType: null, spendControlReached: false } }, accountId: 'must-not-appear' };
describe('P09-I01 provider usage sources', () => {
  const ok = async () => ({ provider: 'codex', state: 'ok' as const, detail: '' });
  it('P09-I01 parses the real Codex quota shape without copying the account identifier', () => {
    const parsed = parseCodexRateLimits(realShape, '2026-10-07T10:00:00.000Z');
    expect(parsed.plan).toBe('plus'); expect(parsed.limitReached).toBe(false);
    expect(parsed.observations).toHaveLength(1);
    expect(parsed.observations[0]).toMatchObject({ source: 'measured', metric: 'account_quota_percent', unit: 'percent', scope: 'account', value: 12.5, window: { kind: 'fixed', seconds: 604800 } });
    expect(JSON.stringify(parsed)).not.toContain('must-not-appear');
    expect(parseCodexRateLimits({ rateLimits: { limitId: 'x', rateLimitReachedType: 'primary', primary: { usedPercent: 100 } } }).limitReached).toBe(true);
  });
  it('P09-I01 distinguishes measured, unsupported, expired login, network failure and stale readings', async () => {
    expect((await readUsage('codex', { codex: async () => realShape, auth: ok })).state).toBe('measured');
    const noSource = await readUsage('claude');
    expect(noSource).toMatchObject({ state: 'unsupported' }); expect(noSource.observations[0]).toMatchObject({ source: 'missing', value: null });
    expect((await readUsage('codex', { codex: async () => realShape, auth: async () => ({ provider: 'codex', state: 'expired', detail: '' }) })).state).toBe('auth');
    expect((await readUsage('codex', { codex: async () => { throw new Error('connect ECONNREFUSED 1.2.3.4:443'); }, auth: ok })).state).toBe('network');
    expect((await readUsage('codex', { codex: async () => { throw new Error('401 unauthorized'); }, auth: ok })).state).toBe('auth');
    expect((await readUsage('codex', { codex: async () => ({}), auth: ok })).state).toBe('unsupported');
    const read = await readUsage('codex', { codex: async () => realShape, auth: ok, now: new Date('2026-10-07T10:00:00Z') });
    expect(withFreshness(read, new Date('2026-10-07T10:30:00Z')).observations[0]!.source).toBe('stale');
  });
  it('P09-I01 a failed read never prevents the task from being recovered', async () => {
    const store = new Store(mkdtempSync(join(tmpdir(), 'lagoto-usage-'))); stores.push(store); const service = new Service(store);
    const call = (method: string, params: Record<string, unknown> = {}) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
    const project = await call('project/create', { name: 'U' }); const task = await call('task/create', { projectId: project.id, title: 'T' });
    expect((await call('usage/read', { provider: 'cursor' })).state).toBe('unsupported');
    expect((await call('task/snapshot', { taskId: task.id })).task.id).toBe(task.id);
    expect(await call('budget/summary')).toMatchObject({ average: null });
  });
});
