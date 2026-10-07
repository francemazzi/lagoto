import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';

const stores: Store[] = [];
afterEach(() => { for (const s of stores.splice(0)) { try { s.close(); } catch { /* closed */ } rmSync(s.directory, { recursive: true, force: true }); } });

async function setup() {
  const store = new Store(mkdtempSync(join(tmpdir(), 'lagoto-states-'))); stores.push(store); const service = new Service(store);
  const call = (method: string, params: Record<string, unknown> = {}) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
  const project = await call('project/create', { name: 'S' }); const task = await call('task/create', { projectId: project.id, title: 'T' });
  const make = async (name: string, provider: string, capabilities: object, enabled = 1) => {
    const profile = await call('profile/create', { name, provider, model: name });
    store.db.prepare('UPDATE profiles SET capabilities=?,enabled=? WHERE id=?').run(JSON.stringify(capabilities), enabled, profile.id); return profile;
  };
  const verified = { modes: ['agent'], efforts: [], verification: 'passed' };
  const pool = (profileId: string, residual: number, percentSpent = 0, resetInDays = 10) => {
    const id = crypto.randomUUID(), cycle = crypto.randomUUID(), reset = new Date(Date.now() + resetInDays * 86400000).toISOString();
    store.db.prepare('INSERT INTO budget_pools(id,name,unit,residual,reserve,reset_at,cycle,timezone) VALUES(?,?,?,?,?,?,?,?)').run(id, 'P' + id.slice(0, 4), 'tokens', residual, Math.ceil(residual / 10), reset, cycle, 'UTC');
    store.db.prepare('INSERT INTO budget_cycles VALUES(?,?,?,?,?,?)').run(cycle, id, residual, Math.ceil(residual / 10), reset, new Date(Date.now() - 86400000).toISOString());
    store.db.prepare('INSERT INTO profile_pools(profile_id,pool_id,reservation) VALUES(?,?,?)').run(profileId, id, 1);
    if (percentSpent) { const a = (store.db.prepare('SELECT id,assigned FROM allowances WHERE pool=?').get(id) as any); void a; }
    return id;
  };
  const run = (profileId: string, state: string, payload?: object, extra?: { error?: string }) => {
    const id = crypto.randomUUID();
    store.db.prepare('INSERT INTO runs(id,task_id,profile_id,state,model,created_at) VALUES(?,?,?,?,?,?)').run(id, task.id, profileId, state, 'm', new Date().toISOString());
    if (payload) store.event(task.id, id, 'run_state', payload);
    if (extra?.error) store.event(task.id, id, 'error', { message: extra.error });
    return id;
  };
  const states = async () => Object.fromEntries((await call('profile/states')).map((s: any) => [s.profileId, s]));
  return { store, call, make, verified, pool, run, states };
}

describe('P02-I04 each profile states what it is and what to do, and ready means usable', () => {
  it('P02-I04 distinguishes budget, local, calibrating, unverified, failed verification, expired access and disabled', async () => {
    const s = await setup();
    const budget = await s.make('budget', 'codex', s.verified); s.pool(budget.id, 30_000_000);
    const local = await s.make('local', 'ollama', s.verified);
    const calibrating = await s.make('cloud-no-budget', 'claude', s.verified);
    const unverified = await s.make('unverified', 'cursor', { modes: [], efforts: [], verification: 'unverified' });
    const failed = await s.make('failed', 'codex', { modes: [], efforts: [], verification: 'failed', proof: { message: 'Il rifiuto del comando non è stato applicato' } });
    const expired = await s.make('expired-login', 'claude', { modes: [], efforts: [], verification: 'failed', proof: { message: 'Failed to authenticate: OAuth session expired' } });
    const checking = await s.make('checking', 'codex', { modes: [], efforts: [], verification: 'checking' });
    const off = await s.make('off', 'codex', s.verified, 0);
    const st = await s.states();
    expect(st[budget.id]).toMatchObject({ key: 'ready', ready: true, tone: 'ok' }); expect(st[budget.id].label).toMatch(/^Pronto · \d+% oggi$/);
    expect(st[local.id]).toMatchObject({ key: 'ready-local', label: 'Locale · disponibile', ready: true, percent: null });
    expect(st[calibrating.id]).toMatchObject({ key: 'calibrating', label: 'In calibrazione', ready: true });
    expect(st[unverified.id]).toMatchObject({ key: 'unverified', ready: false }); expect(st[unverified.id].action).toContain('Verifica');
    expect(st[failed.id]).toMatchObject({ key: 'verification-failed', ready: false });
    expect(st[expired.id]).toMatchObject({ key: 'auth-needed', label: 'Accesso da rinnovare', ready: false });
    expect(st[checking.id]).toMatchObject({ key: 'verifying', ready: false });
    expect(st[off.id]).toMatchObject({ key: 'disabled', ready: false });
  });
  it('P02-I04 a positive budget never makes a blocked provider look ready: provider limit, credit, lost run, exhausted or expired budget', async () => {
    const s = await setup();
    const limit = await s.make('limit', 'codex', s.verified); s.pool(limit.id, 30_000_000);
    s.run(limit.id, 'failed', { state: 'failed', cause: 'quota', message: 'usage limit' });
    const credit = await s.make('credit', 'claude', s.verified); s.pool(credit.id, 30_000_000);
    s.run(credit.id, 'failed', { state: 'failed', cause: 'credit', message: '402' });
    const lost = await s.make('lost', 'cursor', s.verified); s.pool(lost.id, 30_000_000); s.run(lost.id, 'unknown');
    const empty = await s.make('empty', 'openrouter', s.verified); const pool = s.pool(empty.id, 30_000_000);
    const renew = await s.make('renew', 'kimi', s.verified); s.pool(renew.id, 30_000_000, 0, -1);
    let st = await s.states();
    expect(st[limit.id]).toMatchObject({ key: 'provider-limit', label: 'Limite del provider raggiunto', ready: false, tone: 'blocked' });
    expect(st[credit.id]).toMatchObject({ key: 'credit-exhausted', ready: false });
    expect(st[lost.id]).toMatchObject({ key: 'run-lost', ready: false });
    expect(st[renew.id]).toMatchObject({ key: 'budget-renew', label: 'Budget da rinnovare', ready: false });
    s.store.db.prepare('UPDATE allowances SET spent=assigned WHERE pool=?').run(pool);
    new (await import('../runtime/budget.js')).RunBudgets(s.store).status(empty.id);
    s.store.db.prepare('UPDATE allowances SET spent=assigned WHERE pool=?').run(pool);
    st = await s.states();
    expect(st[empty.id]).toMatchObject({ key: 'budget-exhausted', ready: false, percent: 0 });
    const old = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    s.store.db.prepare("UPDATE events SET created_at=? WHERE kind='run_state'").run(old);
    expect((await s.states())[limit.id]).toMatchObject({ key: 'ready' });
  });
  it('P02-I04 a failed checkpoint is shown without blocking, with the action to take, and a sub-1% battery reads <1%', async () => {
    const s = await setup();
    const p = await s.make('cp', 'codex', s.verified); s.pool(p.id, 30_000_000);
    s.run(p.id, 'finished', { state: 'finished' }, { error: 'Checkpoint non salvato: disco pieno' });
    expect(await s.states()).toMatchObject({ [p.id]: { key: 'checkpoint-failed', ready: true, tone: 'warning' } });
    const q = await s.make('tiny', 'codex', s.verified); s.pool(q.id, 30_000_000);
    const a = new (await import('../runtime/budget.js')).RunBudgets(s.store).status(q.id).allowance!;
    s.store.db.prepare('UPDATE allowances SET spent=? WHERE id=?').run(a.assigned - 1000, a.id);
    expect((await s.states())[q.id]).toMatchObject({ key: 'ready', label: 'Pronto · <1% oggi' });
  });
});
