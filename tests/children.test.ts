import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, gitTask } from './helpers/git-task.js';
import { claudeNormalizer } from '../runtime/adapters.js';
import { childCapability, childrenOf } from '../runtime/children.js';
import { contextPack } from '../runtime/checkpoint.js';
import { RunManager } from '../runtime/runs.js';
import { Handoffs } from '../runtime/handoff.js';
import { transcript } from '../runtime/transcript.js';
import { RunBudgets } from '../runtime/budget.js';

afterEach(cleanup);

// Message shapes follow Claude Code stream-json: a Task tool_use starts a sub-agent, its tool_result ends it.
const taskStart = (id: string, description: string) => ({ type: 'assistant', message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name: 'Task', input: { description, prompt: 'x' } }] } });
const taskEnd = (id: string, text: string, isError = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }] } });

async function withRun(provider: string) {
  const f = await gitTask();
  const profile = await f.call('profile/create', { name: 'P', provider, model: 'm' });
  const run = crypto.randomUUID();
  f.store.db.prepare('INSERT INTO runs(id,task_id,profile_id,state,model,created_at) VALUES(?,?,?,?,?,?)').run(run, f.task.id, profile.id, 'running', 'm', new Date().toISOString());
  const emit = (events: any[]) => { for (const event of events) f.store.event(f.task.id, run, event.kind, event); };
  return { f, profile, run, emit };
}

describe('P10-I03 children come only from observed events', () => {
  it('P10-I03 builds children from Claude Task events, marks an unanswered one as missing and never reads chat text', async () => {
    const { f, run, emit } = await withRun('claude');
    const normalize = claudeNormalizer();
    emit(normalize(taskStart('t1', 'Controlla il contratto')));
    emit(normalize(taskStart('t2', 'Scrivi i test')));
    emit(normalize(taskEnd('t1', 'Contratto valido', false)));
    emit([{ kind: 'text', text: 'Ho creato tre sotto-agenti: A, B e C', payload: {} }]);
    expect(childrenOf(f.store.db, run).map(c => [c.childId, c.state])).toEqual([['t1', 'completed'], ['t2', 'started']]);
    f.store.db.prepare("UPDATE runs SET state='finished' WHERE id=?").run(run);
    const children = childrenOf(f.store.db, run);
    expect(children.find(c => c.childId === 't2')).toMatchObject({ state: 'missing', result: null });
    expect(children.find(c => c.childId === 't1')).toMatchObject({ state: 'completed', result: 'Contratto valido', title: 'Controlla il contratto' });
    expect(children).toHaveLength(2);
    const blocks = (transcript(f.store.db, f.task.id).blocks as any[]).filter(b => b.kind === 'child');
    expect(blocks.map(b => b.text)).toEqual(['Controlla il contratto', 'Scrivi i test']);
  });
  it('P10-I03 a runtime without observable children is reported as partial, not as having none', async () => {
    const cursor = await withRun('cursor');
    expect(childCapability('cursor')).toBe('none'); expect(childCapability('claude')).toBe('observed');
    const report = await cursor.f.call('task/children', { taskId: cursor.f.task.id });
    expect(report).toEqual([expect.objectContaining({ capability: 'none', partial: true, children: [] })]);
    expect(report[0].note).toContain('non è provata');
    const claude = await withRun('claude');
    expect((await claude.f.call('task/children', { taskId: claude.f.task.id }))[0]).toMatchObject({ capability: 'observed', partial: false });
  });
});

describe('P10-I04 child results survive the parent', () => {
  it('P10-I04 finished child results travel in the Context Pack and an unreceived result stays missing', async () => {
    const { f, run, emit } = await withRun('claude');
    const normalize = claudeNormalizer();
    emit(normalize(taskStart('c1', 'Analisi')));
    emit(normalize(taskEnd('c1', 'Risultato persistito: 3 problemi')));
    emit(normalize(taskStart('c2', 'Mai risposto')));
    f.store.db.prepare("UPDATE runs SET state='interrupted' WHERE id=?").run(run);
    const pack = JSON.parse(contextPack(f.store, f.task.id, 48000).content);
    expect(pack.children).toEqual([
      expect.objectContaining({ childId: 'c1', state: 'completed', result: 'Risultato persistito: 3 problemi' }),
      expect.objectContaining({ childId: 'c2', state: 'missing', result: null }),
    ]);
  });
});

describe('P10-I05 individual control is offered only where it exists', () => {
  it('P10-I05 an individual child stop is declared unsupported, the child is not reported stopped, and a surviving writer blocks the handoff', async () => {
    const { f, run, emit, profile } = await withRun('claude');
    emit(claudeNormalizer()(taskStart('c1', 'Scrive file')));
    const outcome = await f.call('child/stop', { runId: run, childId: 'c1' });
    expect(outcome).toMatchObject({ stopped: false }); expect(outcome.reason).toContain('singolo figlio');
    expect(childrenOf(f.store.db, run)[0]).toMatchObject({ state: 'started' });
    const event = (f.store.events(f.task.id) as any[]).find(e => e.kind === 'child_control');
    expect(event.payload.outcome).toBe('unsupported');
    f.store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run(JSON.stringify({ modes: ['agent'], efforts: [], verification: 'passed' }), profile.id);
    f.store.db.prepare("UPDATE runs SET state='unknown' WHERE id=?").run(run);
    const handoffs = new Handoffs(f.store, new RunManager(f.store, () => {}, async () => { throw new Error('must not start'); }), f.service.verifications);
    await expect(handoffs.prepare(f.task.id, profile.id, crypto.randomUUID())).rejects.toThrow('Writer incerto');
  });
});

describe('P10-I06 child costs are never invented or added twice', () => {
  it('P10-I06 an unknown child cost stays unknown and child detail inside a parent total is not added', async () => {
    const { f, run, emit, profile } = await withRun('claude');
    emit(claudeNormalizer()(taskStart('c1', 'Costoso')));
    expect(childrenOf(f.store.db, run)[0]!.usage).toBeNull();
    const pool = crypto.randomUUID(), cycle = crypto.randomUUID(), reset = new Date(Date.now() + 10 * 86400000).toISOString();
    f.store.db.prepare('INSERT INTO budget_pools(id,name,unit,residual,reserve,reset_at,cycle,timezone) VALUES(?,?,?,?,?,?,?,?)').run(pool, 'P', 'tokens', 10_000_000, 1_000_000, reset, cycle, 'UTC');
    f.store.db.prepare('INSERT INTO budget_cycles VALUES(?,?,?,?,?,?)').run(cycle, pool, 10_000_000, 1_000_000, reset, new Date(Date.now() - 86400000).toISOString());
    f.store.db.prepare('INSERT INTO profile_pools(profile_id,pool_id,reservation) VALUES(?,?,?)').run(profile.id, pool, 1);
    const budgets = new RunBudgets(f.store);
    f.store.db.prepare("UPDATE runs SET state='finished' WHERE id=?").run(run);
    budgets.reserve(run, profile.id);
    budgets.observe(run, { usage: { total_tokens: 8000 } });
    budgets.observe(run, { child: { childId: 'c1', totalTokens: 3000 } });
    budgets.finish(run, 'finished');
    expect(budgets.status(profile.id).allowance!.spent).toBe(8000);
  });
});
