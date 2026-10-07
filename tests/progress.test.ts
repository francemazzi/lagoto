import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, gitTask } from './helpers/git-task.js';
import { RunManager } from '../runtime/runs.js';

afterEach(cleanup);

describe('P09-I04 completion is proven on the current revision, never claimed', () => {
  it('P09-I04 a model saying it is done does not complete the task; code changes invalidate the matching proof; qualitative criteria need a human waiver', async () => {
    const f = await gitTask();
    const profile = await f.call('profile/create', { name: 'F', provider: 'codex', model: 'm' });
    f.store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run(JSON.stringify({ modes: ['agent'], efforts: [], verification: 'passed' }), profile.id);
    const runs = new RunManager(f.store, () => {}, async options => { options.onEvent({ kind: 'text', text: 'Ho finito: tutto completato.', payload: {} }); options.onEvent({ kind: 'result', text: 'Ho finito: tutto completato.', payload: {} }); return { sessionId: 's', completion: Promise.resolve(), stop: async () => {} }; });
    const run = await runs.start(f.task.id, profile.id, 'finish', crypto.randomUUID(), 'agent') as any;
    for (let i = 0; i < 100 && (f.store.db.prepare('SELECT state FROM runs WHERE id=?').get(run.id) as any).state !== 'finished'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    await runs.shutdown();
    expect((await f.call('task/progress', { taskId: f.task.id })).status).not.toBe('completed');
    await expect(f.call('task/complete', { taskId: f.task.id })).rejects.toThrow('criteri');
    const tested = await f.call('criterion/edit', { taskId: f.task.id, content: 'Il contratto esiste', reason: 'Requisito iniziale' });
    const qualitative = await f.call('criterion/edit', { taskId: f.task.id, content: 'Il codice è leggibile', reason: 'Giudizio umano' });
    const proof = await f.verify('test -f contract.json');
    await f.call('criterion/accept', { taskId: f.task.id, id: tested.id, revision: 1, verificationId: proof.id });
    await expect(f.call('criterion/accept', { taskId: f.task.id, id: qualitative.id, revision: 1 })).rejects.toThrow('verifica valida oppure una deroga');
    await expect(f.call('criterion/accept', { taskId: f.task.id, id: qualitative.id, revision: 1, verificationId: proof.id, overrideReason: 'both' })).rejects.toThrow();
    await expect(f.call('task/complete', { taskId: f.task.id })).rejects.toThrow('criteri');
    await f.call('criterion/accept', { taskId: f.task.id, id: qualitative.id, revision: 1, overrideReason: 'Rivisto da me' });
    expect((await f.call('task/progress', { taskId: f.task.id })).criteria.map((c: any) => c.state).sort()).toEqual(['verified', 'waived']);
    writeFileSync(join(f.work.path, 'contract.json'), '{"version":2}\n');
    const after = await f.call('task/progress', { taskId: f.task.id });
    expect(after.criteria.find((c: any) => c.id === tested.id).state).toBe('stale');
    expect(after.criteria.find((c: any) => c.id === qualitative.id).state).toBe('waived');
    expect(after.phase).toBe('verify');
  });
});

describe('P09-I05 next steps are concrete and every change of the total has a reason', () => {
  it('P09-I05 a new requirement changes the total with its reason and blockers name real facts', async () => {
    const f = await gitTask();
    let progress = await f.call('task/progress', { taskId: f.task.id });
    expect(progress).toMatchObject({ phase: 'define-criteria', total: 0, completed: 0, blockers: ['Nessun criterio di accettazione definito'] });
    const first = await f.call('criterion/edit', { taskId: f.task.id, content: 'A', reason: 'Requisito iniziale' });
    await f.call('criterion/edit', { taskId: f.task.id, content: 'B', reason: 'Il cliente ha aggiunto un vincolo' });
    progress = await f.call('task/progress', { taskId: f.task.id });
    expect(progress).toMatchObject({ phase: 'verify', total: 2, completed: 0 });
    expect(progress.changes.map((c: any) => c.reason)).toEqual(expect.arrayContaining(['Requisito iniziale', 'Il cliente ha aggiunto un vincolo']));
    expect(progress.missing).toHaveLength(2);
    const proof = await f.verify('test -f contract.json');
    await f.call('criterion/accept', { taskId: f.task.id, id: first.id, revision: 1, verificationId: proof.id });
    progress = await f.call('task/progress', { taskId: f.task.id });
    expect(progress).toMatchObject({ completed: 1, total: 2 });
    expect(progress.missing.map((m: any) => m.content)).toEqual(['B']);
    expect(JSON.stringify(progress)).not.toMatch(/countdown|eta|remaining_time/i);
    f.store.db.prepare("INSERT INTO verifications(id,task_id,command,fingerprint,state,output,created_at) VALUES(?,?,?,?,?,?,?)").run(crypto.randomUUID(), f.task.id, '{}', 'x', 'running', '', new Date().toISOString());
    expect((await f.call('task/progress', { taskId: f.task.id })).blockers).toContain('Verifica in corso');
  });
});
