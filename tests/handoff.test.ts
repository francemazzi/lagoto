import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, gitTask } from './helpers/git-task.js';
import { Handoffs } from '../runtime/handoff.js';
import { RunManager } from '../runtime/runs.js';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import type { RunOptions, RunningAdapter } from '../runtime/adapters.js';

afterEach(cleanup);
type Fixture = Awaited<ReturnType<typeof gitTask>>;

async function setup() {
  const f = await gitTask({ files: { 'a.txt': 'alpha' } });
  const profile = async (name: string, modes = ['agent']) => {
    const p = await f.call('profile/create', { name, provider: 'codex', model: name });
    f.store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run(JSON.stringify({ modes, efforts: [], verification: 'passed' }), p.id);
    return p;
  };
  const cloud = await profile('cloud'), local = await profile('local'), other = await profile('other');
  const prompts: string[] = []; const adapters: { stop: number; finish: () => void }[] = [];
  const factory = async (options: RunOptions): Promise<RunningAdapter> => {
    prompts.push(options.prompt);
    let finish!: () => void; const completion = new Promise<void>(resolve => { finish = resolve; });
    const state = { stop: 0, finish }; adapters.push(state);
    return { sessionId: 's', completion, stop: async () => { state.stop++; finish(); } };
  };
  const runs = new RunManager(f.store, () => {}, factory);
  const handoffs = new Handoffs(f.store, runs, f.service.verifications);
  const startOn = async (p: { id: string }, text = 'work') => {
    const run = await runs.start(f.task.id, p.id, text, crypto.randomUUID(), 'agent') as any;
    for (let i = 0; i < 100 && (f.store.db.prepare('SELECT state FROM runs WHERE id=?').get(run.id) as any).state !== 'running'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    return run;
  };
  return { f, cloud, local, other, runs, handoffs, prompts, adapters, startOn, factory };
}
const runState = (f: Fixture, id: string) => (f.store.db.prepare('SELECT state FROM runs WHERE id=?').get(id) as any).state;
const runCount = (f: Fixture) => (f.store.db.prepare('SELECT count(*) AS count FROM runs').get() as any).count;

describe('P08-I04 interruption and crash around a test', () => {
  it('P08-I04 HAND-01 an interruption after an edit and before any test keeps the file and runs no verification', async () => {
    const s = await setup();
    const run = await s.startOn(s.cloud);
    writeFileSync(join(s.f.work.path, 'edited.txt'), 'written by the first model');
    const preview = await s.handoffs.prepare(s.f.task.id, s.local.id, crypto.randomUUID()) as any;
    expect(runState(s.f, run.id)).toBe('interrupted');
    expect(preview.state).toBe('preview');
    const pack = JSON.parse(preview.context);
    expect(JSON.stringify(pack.checkpoint)).toContain('edited.txt');
    expect(pack.verifications).toEqual([]);
    expect(existsSync(join(s.f.work.path, 'edited.txt'))).toBe(true);
  });
  it('P08-I04 HAND-02 a verification interrupted by the handoff keeps its partial output; one killed by a crash stays unknown until reconciled', async () => {
    const s = await setup();
    await s.f.call('verification/start', { taskId: s.f.task.id, repositoryId: s.f.repo.id, command: 'echo partial-output; sleep 30' });
    await new Promise(resolve => setTimeout(resolve, 300));
    const preview = await s.handoffs.prepare(s.f.task.id, s.local.id, crypto.randomUUID()) as any;
    const list = await s.f.call('verification/list', { taskId: s.f.task.id });
    expect(list[0]).toMatchObject({ state: 'interrupted' }); expect(list[0].output).toContain('partial-output');
    expect(JSON.parse(preview.context).verifications[0].state).toBe('interrupted');
    // A verification found "running" after a crash is unknown and blocks a handoff until reconciled, never replayed.
    const crashed = await setup();
    crashed.f.store.db.prepare("INSERT INTO verifications(id,task_id,command,fingerprint,state,output,created_at) VALUES(?,?,?,?,?,?,?)").run('v-crash', crashed.f.task.id, '{}', 'f', 'unknown', 'partial before crash', new Date().toISOString());
    await expect(crashed.handoffs.prepare(crashed.f.task.id, crashed.local.id, crypto.randomUUID())).rejects.toThrow('verifica');
    expect(runCount(crashed.f)).toBe(0);
  });
  it('P08-I04 HAND-06 an external action with an unknown outcome is carried as uncertain and never replayed', async () => {
    const s = await setup();
    s.f.store.db.prepare('INSERT INTO external_actions(id,task_id,kind,state,payload,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(), s.f.task.id, 'github-push', 'unknown', '{"repo":"example"}', new Date().toISOString());
    const preview = await s.handoffs.prepare(s.f.task.id, s.local.id, crypto.randomUUID()) as any;
    const pack = JSON.parse(preview.context);
    expect(pack.uncertain).toEqual([expect.objectContaining({ kind: 'github-push', state: 'unknown' })]);
    expect(s.prompts).toHaveLength(0);
  });
});

describe('P08-I05 HAND-04 a crash or a retry in any transition yields one successor', () => {
  it('P08-I05 HAND-04 a failure before the checkpoint resumes the same intention; concurrent confirmations start exactly one run', async () => {
    const s = await setup();
    s.f.store.db.prepare("INSERT INTO verifications(id,task_id,command,fingerprint,state,output,created_at) VALUES(?,?,?,?,?,?,?)").run('v1', s.f.task.id, '{}', 'f', 'unknown', '', new Date().toISOString());
    const id = crypto.randomUUID();
    await expect(s.handoffs.prepare(s.f.task.id, s.local.id, id)).rejects.toThrow();
    expect(s.handoffs.get(id)).toMatchObject({ state: 'unknown' });
    expect(runCount(s.f)).toBe(0);
    await expect(s.handoffs.prepare(s.f.task.id, s.other.id, crypto.randomUUID())).rejects.toThrow();
    s.f.store.db.prepare("UPDATE verifications SET state='interrupted' WHERE id='v1'").run();
    const preview = await s.handoffs.prepare(s.f.task.id, s.local.id, id) as any;
    expect(preview.state).toBe('preview');
    const results = await Promise.allSettled([1, 2, 3].map(() => s.handoffs.confirm(id, preview.context_hash, 'continue', 'agent')));
    expect(results.filter(r => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    const ids = new Set(results.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<any>).value.id));
    expect(ids.size).toBe(1);
    expect(runCount(s.f)).toBe(1); expect(s.prompts).toHaveLength(1);
    expect(s.handoffs.get(id)).toMatchObject({ state: 'started' });
  });
  it('P08-I05 HAND-04 a runtime crash after the successor was accepted is resumed without a second run or a second writer', async () => {
    const s = await setup();
    const id = crypto.randomUUID();
    const preview = await s.handoffs.prepare(s.f.task.id, s.local.id, id) as any;
    const first = await s.handoffs.confirm(id, preview.context_hash, 'continue', 'agent') as any;
    const directory = s.f.store.directory; s.f.store.close();
    const store = new Store(directory); const service = new Service(store);
    let relaunched = 0;
    const runs = new RunManager(store, () => {}, async () => { relaunched++; throw new Error('must not relaunch'); });
    const resumed = new Handoffs(store, runs, service.verifications);
    expect(await resumed.prepare(s.f.task.id, s.local.id, id)).toMatchObject({ state: 'started', successor_id: first.id });
    expect(await resumed.confirm(id, preview.context_hash, 'continue', 'agent')).toMatchObject({ id: first.id });
    expect(relaunched).toBe(0);
    expect((store.db.prepare('SELECT state FROM runs WHERE id=?').get(first.id) as any).state).toBe('unknown');
    await expect(resumed.prepare(s.f.task.id, s.other.id, crypto.randomUUID())).rejects.toThrow('Writer incerto');
    expect((store.db.prepare('SELECT count(*) AS count FROM runs').get() as any).count).toBe(1);
    store.close();
  });
  it('P08-I05 HAND-04 a rejected start leaves the handoff in preview with no run and no ownership transferred; a cancelled intention cannot be reused', async () => {
    const s = await setup();
    const id = crypto.randomUUID();
    const preview = await s.handoffs.prepare(s.f.task.id, s.local.id, id) as any;
    s.f.store.db.prepare('UPDATE profiles SET enabled=0 WHERE id=?').run(s.local.id);
    await expect(s.handoffs.confirm(id, preview.context_hash, 'continue', 'agent')).rejects.toThrow();
    expect(s.handoffs.get(id).state).toBe('preview'); expect(runCount(s.f)).toBe(0);
    s.f.store.db.prepare('UPDATE profiles SET enabled=1 WHERE id=?').run(s.local.id);
    expect(s.handoffs.cancel(id)).toEqual({ cancelled: true });
    await expect(s.handoffs.prepare(s.f.task.id, s.local.id, id)).rejects.toThrow('annullato');
    await expect(s.handoffs.confirm(id, 'wrong-hash', 'x', 'agent')).rejects.toThrow('Anteprima');
  });
});

describe('P08-I01 P08-I03 HAND-03 a surviving or unknown writer blocks the successor', () => {
  it('P08-I01 HAND-03 an unknown writer blocks the handoff on the same worktree even when its lock expired', async () => {
    const s = await setup();
    const run = await s.startOn(s.cloud);
    s.f.store.db.prepare("UPDATE runs SET state='unknown' WHERE id=?").run(run.id);
    await expect(s.handoffs.prepare(s.f.task.id, s.local.id, crypto.randomUUID())).rejects.toThrow('Writer incerto');
    expect(runCount(s.f)).toBe(1);
    await expect(s.runs.start(s.f.task.id, s.local.id, 'second writer', crypto.randomUUID(), 'agent')).rejects.toThrow();
    expect(s.prompts).toHaveLength(1);
  });
});

describe('P08-I03 HAND-05 HAND-08 HAND-09 what the successor receives and what it lacks', () => {
  it('P08-I03 HAND-05 cloud to local to cloud keeps requirements, decisions and files without a manual briefing', async () => {
    const s = await setup();
    await s.f.call('decision/save', { taskId: s.f.task.id, content: 'Usare solo SQLite' });
    await s.f.call('criterion/edit', { taskId: s.f.task.id, content: 'Il contratto esiste', reason: 'Requisito' });
    await s.startOn(s.cloud, 'start');
    writeFileSync(join(s.f.work.path, 'work.txt'), 'progress made by the first model');
    for (const target of [s.local, s.cloud]) {
      const id = crypto.randomUUID();
      const preview = await s.handoffs.prepare(s.f.task.id, target.id, id) as any;
      await s.handoffs.confirm(id, preview.context_hash, 'continua', 'agent');
      for (let i = 0; i < 100 && !s.adapters.at(-1); i++) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(s.prompts).toHaveLength(3);
    for (const prompt of s.prompts.slice(1)) { expect(prompt).toContain('Usare solo SQLite'); expect(prompt).toContain('Il contratto esiste'); expect(prompt).toContain('work.txt'); }
    expect(s.f.store.db.prepare("SELECT count(*) AS count FROM runs WHERE state IN ('starting','running','waiting_permission')").get()).toEqual({ count: 1 });
  });
  it('P08-I03 HAND-08 a recipient without a verified mode is refused and nothing falls back to another profile', async () => {
    const s = await setup();
    const none = await s.f.call('profile/create', { name: 'unverified', provider: 'codex', model: 'u' });
    await expect(s.handoffs.prepare(s.f.task.id, none.id, crypto.randomUUID())).rejects.toThrow('non verificato');
    const planOnly = await s.f.call('profile/create', { name: 'plan-only', provider: 'codex', model: 'p' });
    s.f.store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run(JSON.stringify({ modes: ['plan'], efforts: [], verification: 'passed' }), planOnly.id);
    const id = crypto.randomUUID();
    const preview = await s.handoffs.prepare(s.f.task.id, planOnly.id, id) as any;
    await expect(s.handoffs.confirm(id, preview.context_hash, 'continue', 'agent')).rejects.toThrow('Modalità non verificata');
    expect(runCount(s.f)).toBe(0); expect(s.prompts).toHaveLength(0);
  });
  it('P08-I03 HAND-09 the preview names the recipient, excludes secrets and the secret passed at start never reaches storage', async () => {
    const s = await setup();
    writeFileSync(join(s.f.work.path, '.env'), 'TOKEN=value-that-must-not-travel\n');
    const id = crypto.randomUUID();
    const preview = await s.handoffs.prepare(s.f.task.id, s.local.id, id) as any;
    expect(preview.profile_id).toBe(s.local.id);
    expect(preview.context).not.toContain('value-that-must-not-travel');
    expect(JSON.parse(preview.context).checkpoint.repositories[0].excluded).toContain('.env');
    const secret = 'sk-' + 'a'.repeat(30);
    await s.handoffs.confirm(id, preview.context_hash, 'continue', 'agent', secret);
    const dump = JSON.stringify([s.f.store.db.prepare('SELECT * FROM events').all(), s.f.store.db.prepare('SELECT * FROM handoffs').all(), s.f.store.db.prepare('SELECT * FROM runs').all(), s.f.store.db.prepare('SELECT * FROM transcript').all()]);
    expect(dump).not.toContain(secret);
  });
});
