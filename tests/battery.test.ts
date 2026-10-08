import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { RunBudgets, allowanceAmount } from '../runtime/budget.js';

// 1 EUR = 1,000,000 units of one declared metric. Controlled clock, UTC pool, synthetic data only.
const EUR = 1_000_000;
const roots: string[] = []; const stores: Store[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

async function fixture(options: { residual?: number; startedAt?: string; resetAt?: string; provider?: string; reservation?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lagoto-battery-')); roots.push(root);
  const store = new Store(root); stores.push(store); const service = new Service(store);
  const call = (method: string, params: Record<string, unknown> = {}) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
  const project = await call('project/create', { name: 'Battery' }); const task = await call('task/create', { projectId: project.id, title: 'T' });
  const profile = await call('profile/create', { name: 'A', provider: options.provider ?? 'codex', model: 'm' });
  const residual = options.residual ?? 30 * EUR; const reserve = Math.ceil(residual / 10);
  const poolId = crypto.randomUUID(), cycle = crypto.randomUUID();
  const resetAt = options.resetAt ?? '2026-11-06T00:00:00.000Z', startedAt = options.startedAt ?? '2026-10-06T08:00:00.000Z';
  store.db.prepare('INSERT INTO budget_pools(id,name,unit,residual,reserve,reset_at,cycle,timezone) VALUES(?,?,?,?,?,?,?,?)').run(poolId, 'P', 'tokens', residual, reserve, resetAt, cycle, 'UTC');
  store.db.prepare('INSERT INTO budget_cycles VALUES(?,?,?,?,?,?)').run(cycle, poolId, residual, reserve, resetAt, startedAt);
  if (options.provider !== 'ollama') store.db.prepare('INSERT INTO profile_pools(profile_id,pool_id,reservation) VALUES(?,?,?)').run(profile.id, poolId, options.reservation ?? 180_000);
  const budgets = new RunBudgets(store);
  const spend = (amount: number, date: Date) => {
    const run = crypto.randomUUID();
    store.db.prepare('INSERT INTO runs(id,task_id,profile_id,state,model,created_at) VALUES(?,?,?,?,?,?)').run(run, task.id, profile.id, 'finished', 'm', date.toISOString());
    budgets.reserve(run, profile.id, date);
    budgets.observe(run, { totalTokens: amount });
    budgets.finish(run, 'finished');
    return run;
  };
  return { root, store, call, profile, poolId, cycle, budgets, spend, task };
}
const day = (n: number) => new Date(Date.UTC(2026, 9, 7 + n, 10, 0, 0));

describe('P09-I07 daily allowance arithmetic', () => {
  it('P09-I07 BAT-01 30 EUR, reserve 3 EUR, 30 days gives 0.90 EUR and a 60% battery after 0.36 EUR', async () => {
    const f = await fixture();
    const first = f.budgets.status(f.profile.id, day(0));
    expect(first.allowance!.assigned).toBe(900_000);
    f.spend(360_000, day(0));
    expect(Math.round(f.budgets.status(f.profile.id, day(0)).percent!)).toBe(60);
  });
  it('P09-I07 BAT-02 saving on day one is spread over the remaining days without recomputing day one', async () => {
    const f = await fixture();
    f.budgets.status(f.profile.id, day(0)); f.spend(360_000, day(0));
    expect(f.budgets.status(f.profile.id, day(1)).allowance!.assigned).toBe(918_620);
    expect(allowanceAmount(30 * EUR - 360_000, 3 * EUR, 29)).toBe(918_620);
    expect(f.budgets.status(f.profile.id, day(0)).allowance!.assigned).toBe(900_000);
  });
  it('P09-I07 BAT-03 an overspend shows 0% and the debt lowers the next allowance', async () => {
    const f = await fixture();
    f.budgets.status(f.profile.id, day(0)); f.spend(1_100_000, day(0));
    const today = f.budgets.status(f.profile.id, day(0));
    expect(today.percent).toBe(0); expect(today.allowance!.spent).toBe(1_100_000);
    expect(f.budgets.status(f.profile.id, day(1)).allowance!.assigned).toBe(893_103);
  });
  it('P09-I07 BAT-04 a zero balance, a balance below the reserve and the last day never divide by zero', async () => {
    expect(allowanceAmount(0, 0, 10)).toBe(0);
    expect(allowanceAmount(2 * EUR, 3 * EUR, 10)).toBe(0);
    expect(allowanceAmount(5 * EUR, 3 * EUR, 0)).toBe(0);
    expect(allowanceAmount(5 * EUR, 3 * EUR, 1)).toBe(2 * EUR);
    const f = await fixture({ resetAt: '2026-10-07T00:00:00.000Z' });
    const status = f.budgets.status(f.profile.id, day(0));
    expect(status).toMatchObject({ expired: true, percent: 0 });
  });
  it('P05-I07 BAT-05 the reserve is protected as a floor once and never charged by repeated days', async () => {
    const f = await fixture({ reservation: 1 });
    for (let n = 0; n < 30; n++) {
      const assigned = f.budgets.status(f.profile.id, day(n)).allowance!.assigned;
      if (assigned > 0) f.spend(assigned, day(n));
    }
    const pool = f.store.db.prepare('SELECT residual,reserve FROM budget_pools WHERE id=?').get(f.poolId) as { residual: number; reserve: number };
    expect(pool.reserve).toBe(3 * EUR);
    expect(pool.residual).toBeGreaterThanOrEqual(3 * EUR); expect(pool.residual).toBeLessThanOrEqual(3 * EUR + 40);
    const kinds = f.store.db.prepare('SELECT kind,count(*) AS count FROM ledger GROUP BY kind').all() as { kind: string; count: number }[];
    expect(kinds.find(row => row.kind === 'reservation')?.count).toBe(30);
    expect(kinds.some(row => row.kind === 'reserve')).toBe(false);
  });
  it('P09-I07 BAT-13 a second opening on the same day and a restart keep the frozen assignment', async () => {
    const f = await fixture();
    const a = f.budgets.status(f.profile.id, day(0)).allowance!;
    f.spend(100_000, day(0));
    const b = f.budgets.status(f.profile.id, day(0)).allowance!;
    expect(b.id).toBe(a.id); expect(b.assigned).toBe(a.assigned);
    const directory = f.store.directory; f.store.close();
    const reopened = new Store(directory); stores.push(reopened);
    const c = new RunBudgets(reopened).status(f.profile.id, day(0)).allowance!;
    expect(c.id).toBe(a.id); expect(c.assigned).toBe(a.assigned); expect(c.spent).toBe(100_000);
  });
});

describe('P09-I08 calibration and local availability', () => {
  it('P09-I08 BAT-19 a local profile without a budget is available, never an invented percentage; with a pool it gets a personal percentage', async () => {
    const local = await fixture({ provider: 'ollama' });
    expect(local.budgets.status(local.profile.id)).toEqual({ configured: false, providerQuota: 'unknown', availability: 'local' });
    const cloud = await fixture();
    const unlinked = await cloud.call('profile/create', { name: 'B', provider: 'claude', model: 'x' });
    expect(cloud.budgets.status(unlinked.id)).toMatchObject({ configured: false, availability: 'calibrating' });
    expect(cloud.budgets.status(cloud.profile.id, day(0))).toMatchObject({ configured: true, availability: 'budget' });
  });
});

describe('P09-I09 reconciliation of account snapshots and external consumption', () => {
  it('P09-I09 BAT-08 local usage and an account snapshot over the same interval count once', async () => {
    const f = await fixture();
    f.budgets.status(f.profile.id, new Date());
    const t0 = new Date(Date.now() - 5 * 60_000);
    expect(f.budgets.reconcileSnapshot(f.poolId, 1_000_000, t0, { date: new Date(), source: 'account' })).toMatchObject({ state: 'baseline' });
    f.spend(400_000, new Date());
    const result = f.budgets.reconcileSnapshot(f.poolId, 1_400_000, new Date(), { date: new Date(), source: 'account' });
    expect(result).toMatchObject({ state: 'applied', delta: 400_000, local: 400_000, external: 0, coverage: 'complete' });
    expect((f.store.db.prepare('SELECT residual FROM budget_pools WHERE id=?').get(f.poolId) as any).residual).toBe(30 * EUR - 400_000);
  });
  it('P09-I09 BAT-09 external consumption today is attributed to today; across days it lowers the balance and is declared unattributed', async () => {
    const f = await fixture();
    const now = new Date(); f.budgets.status(f.profile.id, now);
    f.budgets.reconcileSnapshot(f.poolId, 0, new Date(now.getTime() - 5 * 60_000), { date: now });
    const same = f.budgets.reconcileSnapshot(f.poolId, 250_000, now, { date: now });
    expect(same).toMatchObject({ state: 'applied', external: 250_000, attributed: 250_000, coverage: 'complete' });
    expect(f.budgets.status(f.profile.id, now).allowance!.spent).toBe(250_000);
    const g = await fixture();
    const base = new Date(Date.now() - 26 * 3600_000); g.budgets.status(g.profile.id, new Date());
    g.store.db.prepare("INSERT INTO usage_snapshots(id,pool_id,cycle,metric,source,cumulative,observed_at) VALUES(?,?,?,?,?,?,?)").run(crypto.randomUUID(), g.poolId, g.cycle, 'tokens', 'account', 0, base.toISOString());
    const across = g.budgets.reconcileSnapshot(g.poolId, 500_000, new Date(), { date: new Date() });
    expect(across).toMatchObject({ state: 'applied', external: 500_000, attributed: 0, coverage: 'partial' });
    expect(g.budgets.status(g.profile.id, new Date()).allowance!.spent).toBe(0);
    expect((g.store.db.prepare('SELECT residual FROM budget_pools WHERE id=?').get(g.poolId) as any).residual).toBe(30 * EUR - 500_000);
    expect(g.store.db.prepare("SELECT count(*) AS count FROM budget_changes WHERE kind='external_unattributed'").get()).toEqual({ count: 1 });
  });
  it('P09-I09 BAT-10 an old, decreasing, future or invalid snapshot is never turned into spending or a provider percentage', async () => {
    const f = await fixture(); const now = new Date();
    expect(f.budgets.reconcileSnapshot(f.poolId, 10, new Date(now.getTime() - 3600_000), { date: now })).toEqual({ state: 'stale', applied: false });
    f.budgets.reconcileSnapshot(f.poolId, 1000, new Date(now.getTime() - 60_000), { date: now });
    expect(() => f.budgets.reconcileSnapshot(f.poolId, 500, now, { date: now })).toThrow('contatore diminuito');
    expect(() => f.budgets.reconcileSnapshot(f.poolId, -1, now, { date: now })).toThrow('non valido');
    expect(() => f.budgets.reconcileSnapshot(f.poolId, 5, new Date(now.getTime() + 3600_000), { date: now })).toThrow('futuro');
    expect(f.budgets.status(f.profile.id, now)).toMatchObject({ providerQuota: 'unknown' });
    expect((f.store.db.prepare('SELECT residual FROM budget_pools WHERE id=?').get(f.poolId) as any).residual).toBe(30 * EUR);
  });
  it('P05-I07 P09-I09 BAT-16 child detail inside a parent total is never added to it', async () => {
    const f = await fixture();
    const run = crypto.randomUUID();
    f.store.db.prepare('INSERT INTO runs(id,task_id,profile_id,state,model,created_at) VALUES(?,?,?,?,?,?)').run(run, f.task.id, f.profile.id, 'finished', 'm', day(0).toISOString());
    f.budgets.reserve(run, f.profile.id, day(0));
    f.budgets.observe(run, { usage: { total_tokens: 5000 } });
    f.budgets.observe(run, { totalTokens: 2000 });
    f.budgets.observe(run, { child: { totalTokens: 9_000_000 } });
    f.budgets.finish(run, 'finished');
    expect(f.budgets.status(f.profile.id, day(0)).allowance!.spent).toBe(5000);
  });
  it('P09-I09 BAT-22 a first configuration in the middle of the day does not subtract spending it never saw and declares the partial segment', async () => {
    const f = await fixture({ startedAt: '2026-10-07T14:30:00.000Z', residual: 27 * EUR });
    const status = f.budgets.status(f.profile.id, day(0));
    expect(status.segment).toBe('first-day-partial');
    expect(status.allowance).toMatchObject({ spent: 0, assigned: allowanceAmount(27 * EUR, 2_700_000, 30) });
    expect(f.budgets.status(f.profile.id, day(1)).segment).toBe('full-day');
  });
});

describe('P09-I06 thresholds warn once and stop on the precise value', () => {
  it('P09-I06 BAT-20 20%, 10% and 0% each warn once per allowance, survive restart and block at the exact zero', async () => {
    const f = await fixture({ reservation: 1000 });
    const events: any[] = []; f.store.listener = event => events.push(event);
    const status = f.budgets.status(f.profile.id, new Date());
    const assigned = status.allowance!.assigned;
    const run = crypto.randomUUID();
    f.store.db.prepare('INSERT INTO runs(id,task_id,profile_id,state,model,created_at) VALUES(?,?,?,?,?,?)').run(run, f.task.id, f.profile.id, 'running', 'm', new Date().toISOString());
    f.budgets.reserve(run, f.profile.id);
    const levels = [0.5, 0.79, 0.81, 0.9, 0.905, 0.95, 1.0].map(fraction => Math.floor(assigned * fraction));
    const stops = levels.map(total => f.budgets.observe(run, { totalTokens: total }));
    for (const total of levels) f.budgets.observe(run, { totalTokens: total });
    await new Promise(resolve => setTimeout(resolve, 20));
    const thresholds = events.filter(event => event.kind === 'budget_threshold').map(event => event.payload.threshold);
    expect(thresholds).toEqual([20, 10, 0]);
    expect(stops).toEqual([false, false, false, false, false, false, true]);
    expect(f.budgets.status(f.profile.id, new Date()).alerts).toEqual([20, 10, 0]);
    const directory = f.store.directory; f.store.close();
    const reopened = new Store(directory); stores.push(reopened); reopened.listener = event => events.push(event);
    const budgets = new RunBudgets(reopened);
    budgets.observe(run, { totalTokens: assigned });
    expect(events.filter(event => event.kind === 'budget_threshold')).toHaveLength(3);
  });
  it('P09-I06 a positive balance below one percent stays positive and still allows the warning logic to treat it as not zero', async () => {
    const f = await fixture({ reservation: 1 });
    const assigned = f.budgets.status(f.profile.id, new Date()).allowance!.assigned;
    const run = crypto.randomUUID();
    f.store.db.prepare('INSERT INTO runs(id,task_id,profile_id,state,model,created_at) VALUES(?,?,?,?,?,?)').run(run, f.task.id, f.profile.id, 'running', 'm', new Date().toISOString());
    f.budgets.reserve(run, f.profile.id);
    expect(f.budgets.observe(run, { totalTokens: assigned - 2000 })).toBe(false);
    f.budgets.finish(run, 'finished');
    const percent = f.budgets.status(f.profile.id, new Date()).percent!;
    expect(percent).toBeGreaterThan(0); expect(percent).toBeLessThan(1);
  });
});

describe('P09-I10 average battery over enabled profiles', () => {
  it('P09-I10 averages only numeric budgets, highlights the lowest and excludes local, unconfigured, expired and disabled profiles', async () => {
    const f = await fixture({ reservation: 1 });
    const second = await f.call('profile/create', { name: 'Second pool', provider: 'claude', model: 'm2' });
    const pool2 = crypto.randomUUID(), cycle2 = crypto.randomUUID(), reset = new Date(Date.now() + 10 * 86400000).toISOString();
    f.store.db.prepare('INSERT INTO budget_pools(id,name,unit,residual,reserve,reset_at,cycle,timezone) VALUES(?,?,?,?,?,?,?,?)').run(pool2, 'P2', 'tokens', 10 * EUR, EUR, reset, cycle2, 'UTC');
    f.store.db.prepare('INSERT INTO budget_cycles VALUES(?,?,?,?,?,?)').run(cycle2, pool2, 10 * EUR, EUR, reset, new Date(Date.now() - 86400000).toISOString());
    f.store.db.prepare('INSERT INTO profile_pools(profile_id,pool_id,reservation) VALUES(?,?,?)').run(second.id, pool2, 1);
    await f.call('profile/create', { name: 'Local model', provider: 'ollama', model: 'q' });
    await f.call('profile/create', { name: 'No budget', provider: 'openrouter', model: 'z' });
    const off = await f.call('profile/create', { name: 'Disabled', provider: 'cursor', model: 'c' });
    f.store.db.prepare('UPDATE profiles SET enabled=0 WHERE id=?').run(off.id);
    const now = new Date();
    // Drain the first pool to 40%.
    const assigned = f.budgets.status(f.profile.id, now).allowance!.assigned;
    f.spend(Math.floor(assigned * 0.6), now);
    const summary = await f.call('budget/summary');
    expect(summary.count).toBe(2);
    expect(summary.profiles.map((p: any) => p.name).sort()).toEqual(['A', 'Second pool']);
    const first = summary.profiles.find((p: any) => p.name === 'A').percent, other = summary.profiles.find((p: any) => p.name === 'Second pool').percent;
    expect(first).toBeCloseTo(40, 0); expect(other).toBeCloseTo(100, 0);
    expect(summary.average).toBeCloseTo((first + other) / 2, 5);
    expect(summary.lowest).toMatchObject({ name: 'A' });
    expect(summary.excluded.map((e: any) => `${e.name}:${e.reason}`).sort()).toEqual(['Local model:local', 'No budget:no-budget']);
    f.store.db.prepare('UPDATE budget_pools SET reset_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), pool2);
    const expired = await f.call('budget/summary');
    expect(expired.excluded.find((e: any) => e.name === 'Second pool')).toMatchObject({ reason: 'expired' });
    expect(expired.count).toBe(1); expect(expired.average).toBeCloseTo(first, 5);
  });
  it('P09-I10 reports no average at all when no profile has a budget', async () => {
    const f = await fixture({ provider: 'ollama' });
    const summary = await f.call('budget/summary');
    expect(summary).toMatchObject({ average: null, count: 0, lowest: null });
    expect(summary.excluded).toEqual([expect.objectContaining({ reason: 'local' })]);
  });
});
