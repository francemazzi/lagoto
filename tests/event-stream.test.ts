import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { RunManager } from '../runtime/runs.js';

const stores: Store[] = [];
afterEach(() => { for (const store of stores.splice(0)) { store.close(); rmSync(store.directory, { recursive: true, force: true }); } });
const tick = () => new Promise(resolve => setTimeout(resolve, 20));

async function setup() {
  const store = new Store(mkdtempSync(join(tmpdir(), 'lagoto-events-'))); stores.push(store);
  const events: any[] = [];
  const service = new Service(store, event => events.push(event));
  const call = (method: string, params: Record<string, unknown> = {}) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
  const project = await call('project/create', { name: 'Eventi' });
  const task = await call('task/create', { projectId: project.id, title: 'T' });
  return { store, service, call, events, project, task };
}

describe('P02-I08 every state change reaches the UI without polling', () => {
  it('P02-I08 pushes journaled events after commit with object payloads and omits raw provider frames', async () => {
    const { store, events, task } = await setup();
    store.event(task.id, null, 'decision', { id: 'd', content: 'x' });
    store.event(task.id, null, 'raw', { huge: 'y'.repeat(1000) });
    expect(events).toHaveLength(0);
    await tick();
    expect(events.map(event => event.kind)).toEqual(['decision', 'raw']);
    expect(events[0].payload).toEqual({ id: 'd', content: 'x' });
    expect(events[1].payload).toBeNull();
    expect(events[0].seq).toBeLessThan(events[1].seq);
  });
  it('P02-I08 publishes queue and budget changes as signals that carry ids only', async () => {
    const { call, events, task } = await setup();
    await call('task/queue', { taskId: task.id, text: 'secret prompt text', id: crypto.randomUUID() });
    await call('budget/create', { name: 'P', residual: 1000, resetAt: new Date(Date.now() + 5 * 86400000).toISOString() });
    await tick();
    const queue = events.find(event => event.kind === 'queue_changed');
    expect(queue).toMatchObject({ ephemeral: true, payload: { taskId: task.id } });
    expect(JSON.stringify(events)).not.toContain('secret prompt text');
    expect(events.some(event => event.kind === 'budget_changed')).toBe(true);
  });
  it('P02-I08 marks a task as waiting while a permission is pending and clears it on the answer', async () => {
    const { store, call, events, project, task } = await setup();
    const profile = await call('profile/create', { name: 'F', provider: 'codex', model: 'm' });
    store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run(JSON.stringify({ modes: ['agent'], efforts: [], verification: 'passed' }), profile.id);
    const folder = mkdtempSync(join(tmpdir(), 'lagoto-wait-'));
    store.db.prepare('INSERT INTO repositories(id,project_id,name,path) VALUES(?,?,?,?)').run('11111111-1111-4111-8111-111111111111', project.id, 'r', folder);
    store.db.prepare('INSERT INTO task_repositories(task_id,repository_id,path,branch,base) VALUES(?,?,?,?,?)').run(task.id, '11111111-1111-4111-8111-111111111111', folder, 'main', 'HEAD');
    let ask!: (tool: string) => Promise<boolean>; let finish!: () => void;
    const completion = new Promise<void>(resolve => { finish = resolve; });
    const runs = new RunManager(store, () => {}, async options => { ask = tool => options.permission(tool, {}); return { sessionId: 's', completion, stop: async () => {} }; });
    const run = await runs.start(task.id, profile.id, 'x', crypto.randomUUID(), 'agent') as any;
    for (let i = 0; i < 50 && (store.db.prepare('SELECT state FROM runs WHERE id=?').get(run.id) as any).state !== 'running'; i++) await tick();
    const state = () => (store.db.prepare('SELECT state FROM runs WHERE id=?').get(run.id) as any).state;
    const listed = async () => (await call('task/list', { projectId: project.id }))[0];
    expect(state()).toBe('running'); expect((await listed()).waiting).toBe(0);
    const answer = ask('fileChange/requestApproval');
    expect(state()).toBe('waiting_permission'); expect((await listed()).waiting).toBe(1); expect((await listed()).active).toBe(1);
    await tick();
    const permission = events.find(event => event.kind === 'permission');
    expect(events.some(event => event.kind === 'attention_changed' && event.payload.taskId === task.id)).toBe(true);
    runs.answer(run.id, permission.payload.id, true);
    expect(await answer).toBe(true);
    expect(state()).toBe('running'); expect((await listed()).waiting).toBe(0);
    finish(); await runs.shutdown();
  });
});
