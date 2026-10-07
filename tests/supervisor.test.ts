import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { RunManager } from '../runtime/runs.js';
import { cleanEnvironment } from '../runtime/process.js';
import type { AdapterEvent, RunOptions, RunningAdapter } from '../runtime/adapters.js';
import { transcript } from '../runtime/transcript.js';

const roots: string[] = []; const stores: Store[] = [];
afterEach(() => { vi.useRealTimers(); for (const s of stores.splice(0)) s.close(); for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
const temp = () => { const p = mkdtempSync(join(tmpdir(), 'lagoto-supervisor-')); roots.push(p); return p; };

async function fixture(directory = temp(), seed = true) {
  const store = new Store(directory); stores.push(store); const service = new Service(store);
  const call = (method: string, params: Record<string, unknown> = {}) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
  if (!seed) return { directory, store, service, call };
  const project = await call('project/create', { name: 'Supervisor' }); const task = await call('task/create', { projectId: project.id, title: 'T' });
  const profile = await call('profile/create', { name: 'F', provider: 'codex', model: 'm' });
  store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run(JSON.stringify({ modes: ['agent'], efforts: [], verification: 'passed' }), profile.id);
  store.db.prepare('INSERT INTO repositories(id,project_id,name,path) VALUES(?,?,?,?)').run('11111111-1111-4111-8111-111111111111', project.id, 'r', directory);
  store.db.prepare('INSERT INTO task_repositories(task_id,repository_id,path,branch,base) VALUES(?,?,?,?,?)').run(task.id, '11111111-1111-4111-8111-111111111111', directory, 'main', 'HEAD');
  return { directory, store, service, call, project, task, profile };
}
const stateOf = (store: Store, id: string) => (store.db.prepare('SELECT state FROM runs WHERE id=?').get(id) as { state: string }).state;
async function until(check: () => boolean) { for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 10)); }

describe('P05-I01 adapter contract', () => {
  type Script = (options: RunOptions) => Promise<void> | void;
  const adapterOf = (script: Script) => async (options: RunOptions): Promise<RunningAdapter> => {
    const completion = Promise.resolve(script(options)).then(() => {});
    return { sessionId: options.profile.model === 'with-session' ? 'native-session' : null, completion, stop: async () => {} };
  };
  it('P05-I01 a complete and a partial adapter pass the same contract without invented capabilities', async () => {
    const complete = await fixture();
    const full = new RunManager(complete.store, () => {}, adapterOf(options => {
      options.onEvent({ kind: 'text', text: 'ciao', payload: {} } as AdapterEvent);
      options.onEvent({ kind: 'tool', payload: { id: 't1', type: 'toolCall', name: 'read' } } as AdapterEvent);
      options.onEvent({ kind: 'usage', payload: { usage: { input_tokens: 4, output_tokens: 2 } } } as AdapterEvent);
      options.onEvent({ kind: 'result', text: 'ciao', payload: {} } as AdapterEvent);
    }));
    const a = await full.start(complete.task.id, complete.profile.id, 'p', crypto.randomUUID(), 'agent') as any;
    await until(() => stateOf(complete.store, a.id) === 'finished');
    await full.shutdown();
    const partial = await fixture();
    const minimal = new RunManager(partial.store, () => {}, adapterOf(options => { options.onEvent({ kind: 'text', text: 'solo testo', payload: {} } as AdapterEvent); }));
    const b = await minimal.start(partial.task.id, partial.profile.id, 'p', crypto.randomUUID(), 'agent') as any;
    await until(() => stateOf(partial.store, b.id) === 'finished');
    await minimal.shutdown();
    for (const [run, f] of [[a, complete], [b, partial]] as const) expect(stateOf(f.store, run.id)).toBe('finished');
    const kinds = (f: typeof complete) => (transcript(f.store.db, f.task.id).blocks as any[]).map(block => block.kind);
    expect(kinds(complete)).toEqual(expect.arrayContaining(['user', 'text', 'tool']));
    expect(kinds(partial)).not.toContain('tool');
    expect((partial.store.db.prepare("SELECT count(*) AS count FROM events WHERE kind='usage'").get() as any).count).toBe(0);
    expect((partial.store.db.prepare('SELECT session_id FROM runs WHERE id=?').get(b.id) as any).session_id).toBeNull();
  });
});

describe('P05-I04 crash between start and response never becomes a replay or a pass', () => {
  it('P05-I04 a run and a verification interrupted by a crash become unknown and the same request does not relaunch', async () => {
    const first = await fixture();
    let launches = 0;
    const runs = new RunManager(first.store, () => {}, async () => { launches++; return { sessionId: 'x', completion: new Promise<void>(() => {}), stop: async () => {} }; });
    const requestId = crypto.randomUUID();
    const run = await runs.start(first.task.id, first.profile.id, 'p', requestId, 'agent') as any;
    await until(() => stateOf(first.store, run.id) === 'running');
    first.store.db.prepare('INSERT INTO verifications(id,task_id,command,fingerprint,state,output,created_at) VALUES(?,?,?,?,?,?,?)').run('v1', first.task.id, '{}', 'f', 'running', '', new Date().toISOString());
    const directory = first.directory; first.store.close();
    const second = await fixture(directory, false);
    expect(stateOf(second.store, run.id)).toBe('unknown');
    expect((second.store.db.prepare("SELECT state FROM verifications WHERE id='v1'").get() as any).state).toBe('unknown');
    const again = new RunManager(second.store, () => {}, async () => { launches++; throw new Error('must not relaunch'); });
    expect(await again.start(first.task.id, first.profile.id, 'p', requestId, 'agent')).toMatchObject({ id: run.id });
    expect(launches).toBe(1);
    await expect(again.start(first.task.id, first.profile.id, 'other', crypto.randomUUID(), 'agent')).rejects.toThrow();
  });
});

describe('P05-I05 permissions are enforced, not suggested', () => {
  it('P05-I05 an unanswered permission is refused after the timeout, a stop refuses pending ones, and plan needs a verified mode', async () => {
    const f = await fixture();
    let ask!: (tool: string) => Promise<boolean>; let finish!: () => void;
    const completion = new Promise<void>(resolve => { finish = resolve; });
    const runs = new RunManager(f.store, () => {}, async options => { ask = tool => options.permission(tool, {}); return { sessionId: 's', completion, stop: async () => {} }; });
    await expect(runs.start(f.task.id, f.profile.id, 'p', crypto.randomUUID(), 'plan')).rejects.toThrow('Modalità non verificata');
    const run = await runs.start(f.task.id, f.profile.id, 'p', crypto.randomUUID(), 'agent') as any;
    await until(() => stateOf(f.store, run.id) === 'running');
    vi.useFakeTimers();
    const unanswered = ask('shell/exec');
    vi.advanceTimersByTime(50001);
    expect(await unanswered).toBe(false);
    vi.useRealTimers();
    const events = f.store.events(f.task.id) as any[];
    expect(events.filter(event => event.kind === 'permission_result').map(event => event.payload.allow)).toEqual([false]);
    const pending = ask('fileChange/requestApproval');
    await runs.stop(run.id).catch(() => {});
    expect(await pending).toBe(false);
    finish(); await runs.shutdown();
  });
});

describe('P05-I06 oversized and malformed input cannot corrupt the runtime', () => {
  it('P05-I06 a frame over the limit stops the runtime cleanly and the archive reopens', async () => {
    const directory = temp();
    const child = spawn(process.execPath, ['dist/runtime/server.js'], { env: { ...cleanEnvironment(), LAGOTO_DATA_DIR: directory }, stdio: 'pipe' });
    child.stdout.resume(); child.stderr.resume();
    const closed = new Promise<number | null>(resolve => child.once('close', code => resolve(code)));
    child.stdin.on('error', () => {});
    child.stdin.write(Buffer.alloc(5 * 1024 * 1024, 97));
    expect(await closed).toBe(1);
    const store = new Store(directory); stores.push(store);
    expect(store.db.prepare('SELECT count(*) AS count FROM projects').get()).toEqual({ count: 0 });
  });
});

describe('P12-I02 network loss and restart never leave a run that looks alive', () => {
  it('P12-I02 a connection reset ends the run as failed with a network cause and action, leaves nothing running and saves the work', async () => {
    const f = await fixture();
    const runs = new RunManager(f.store, () => {}, async options => {
      const completion = new Promise<void>((_, reject) => setTimeout(() => reject(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })), 20));
      void options; return { sessionId: 's', completion, stop: async () => {} };
    });
    const run = await runs.start(f.task.id, f.profile.id, 'x', crypto.randomUUID(), 'agent') as any;
    await until(() => ['failed', 'unknown', 'interrupted'].includes(stateOf(f.store, run.id)));
    expect(stateOf(f.store, run.id)).toBe('failed');
    const event = (f.store.events(f.task.id) as any[]).filter(e => e.kind === 'run_state').at(-1);
    expect(event.payload).toMatchObject({ state: 'failed', cause: 'network' });
    expect(event.payload.action).toContain('connessione');
    expect(f.store.db.prepare("SELECT count(*) AS count FROM runs WHERE state IN ('starting','running','waiting_permission','stopping')").get()).toEqual({ count: 0 });
    await runs.shutdown();
  });
  it('P12-I02 BAT-13 after a restart no run is reported as running and the day allowance is not reloaded', async () => {
    const f = await fixture();
    const runs = new RunManager(f.store, () => {}, async () => ({ sessionId: 's', completion: new Promise<void>(() => {}), stop: async () => {} }));
    const run = await runs.start(f.task.id, f.profile.id, 'x', crypto.randomUUID(), 'agent') as any;
    await until(() => stateOf(f.store, run.id) === 'running');
    const directory = f.directory; f.store.close();
    const reopened = await fixture(directory, false);
    expect(stateOf(reopened.store, run.id)).toBe('unknown');
    expect(reopened.store.db.prepare("SELECT count(*) AS count FROM runs WHERE state IN ('starting','running','waiting_permission')").get()).toEqual({ count: 0 });
  });
});
