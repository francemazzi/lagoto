import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { RunManager } from '../runtime/runs.js';
import { startAdapter, type RunOptions } from '../runtime/adapters.js';
import { claudeModels, parseCursorModels } from '../runtime/integrations.js';
import { classifyFailure } from '../runtime/errors.js';

const stores: Store[] = [];
afterEach(() => { for (const s of stores.splice(0)) { try { s.close(); } catch { /* closed */ } rmSync(s.directory, { recursive: true, force: true }); } });

async function setup() {
  const store = new Store(mkdtempSync(join(tmpdir(), 'lagoto-int-'))); stores.push(store);
  const events: any[] = []; const service = new Service(store, event => events.push(event));
  const call = (method: string, params: Record<string, unknown> = {}) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
  const project = await call('project/create', { name: 'I' }); const task = await call('task/create', { projectId: project.id, title: 'T' });
  store.db.prepare('INSERT INTO repositories(id,project_id,name,path) VALUES(?,?,?,?)').run('11111111-1111-4111-8111-111111111111', project.id, 'r', store.directory);
  store.db.prepare('INSERT INTO task_repositories(task_id,repository_id,path,branch,base) VALUES(?,?,?,?,?)').run(task.id, '11111111-1111-4111-8111-111111111111', store.directory, 'main', 'HEAD');
  const verified = async (provider: string, model: string, endpoint: string | null = null) => {
    const profile = await call('profile/create', { name: model, provider, model, ...(endpoint ? { endpoint } : {}) });
    store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run(JSON.stringify({ modes: ['agent'], efforts: ['high'], verification: 'passed', proof: { model, endpoint } }), profile.id);
    return profile;
  };
  return { store, service, call, events, project, task, verified };
}

describe('P06-I03 logout, expiry and a changed destination never reuse a key or a proof', () => {
  it('P06-I03 changing the endpoint or the model resets the proof and the stored key, a name change does not, and an active run blocks the edit', async () => {
    const s = await setup();
    const profile = await s.verified('openrouter', 'qwen/qwen3-coder-next', 'https://openrouter.ai/api/v1');
    expect(await s.call('profile/update', { profileId: profile.id, name: 'Renamed' })).toEqual({ updated: true, reverify: false, secretReset: false });
    expect((await s.call('profile/list')).find((p: any) => p.id === profile.id).capabilities.verification).toBe('passed');
    const moved = await s.call('profile/update', { profileId: profile.id, endpoint: 'https://example.invalid/v1' });
    expect(moved).toEqual({ updated: true, reverify: true, secretReset: true });
    const row = (await s.call('profile/list')).find((p: any) => p.id === profile.id);
    expect(row.capabilities).toEqual({ modes: [], efforts: [], verification: 'unverified' });
    await expect(s.call('profile/update', { profileId: crypto.randomUUID(), name: 'x' })).rejects.toThrow('non trovato');
    s.store.db.prepare("INSERT INTO runs(id,task_id,profile_id,state,model,created_at) VALUES(?,?,?,?,?,?)").run(crypto.randomUUID(), s.task.id, profile.id, 'running', 'm', new Date().toISOString());
    await expect(s.call('profile/update', { profileId: profile.id, model: 'other' })).rejects.toThrow('Arresta la run');
  });
  it('P06-I03 logout stops active runs with a verified stop, blocks new starts and asks the app to delete the stored key', async () => {
    const s = await setup();
    const profile = await s.verified('codex', 'm');
    let stops = 0;
    const factory = async (options: RunOptions) => { void options; let finish!: () => void; const completion = new Promise<void>(resolve => { finish = resolve; }); return { sessionId: 's', completion, stop: async () => { stops++; finish(); } }; };
    const runs = new RunManager(s.store, () => {}, factory);
    (s.service as any).runs = runs;
    const run = await runs.start(s.task.id, profile.id, 'x', crypto.randomUUID(), 'agent') as any;
    for (let i = 0; i < 100 && (s.store.db.prepare('SELECT state FROM runs WHERE id=?').get(run.id) as any).state !== 'running'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(await s.call('profile/logout', { profileId: profile.id })).toEqual({ loggedOut: true, stoppedRuns: 1, secretReset: true });
    expect(stops).toBe(1);
    expect((s.store.db.prepare('SELECT state FROM runs WHERE id=?').get(run.id) as any).state).toBe('interrupted');
    await expect(runs.start(s.task.id, profile.id, 'again', crypto.randomUUID(), 'agent')).rejects.toThrow();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(s.events.some(event => event.kind === 'profiles_changed')).toBe(true);
  });
});

describe('P06-I04 catalogs and capabilities are never guessed or silently replaced', () => {
  it('P06-I04 parses the Cursor model list, labels the Claude list as declared and ignores unknown output', () => {
    const listed = parseCursorModels('Available models\n\nauto - Auto (current, default)\ncomposer-2.5 - Composer 2.5\ngpt-5.3-codex-high - Codex 5.3 High\nTip: use --model\n');
    expect(listed.map(model => model.id)).toEqual(['auto', 'composer-2.5', 'gpt-5.3-codex-high']);
    expect(listed.every(model => model.source === 'listed')).toBe(true);
    expect(claudeModels().every(model => model.source === 'declared' && model.efforts.includes('high'))).toBe(true);
    expect(parseCursorModels('')).toEqual([]);
  });
  it('P06-I04 a profile whose model or endpoint changed after verification is refused instead of falling back, and an unsupported effort is refused', async () => {
    const s = await setup();
    const profile = await s.verified('codex', 'gpt-a');
    s.store.db.prepare('UPDATE profiles SET model=? WHERE id=?').run('gpt-b', profile.id);
    const runs = new RunManager(s.store, () => {}, startAdapter, async provider => ({ provider, state: 'ok', detail: '' }));
    await expect(runs.start(s.task.id, profile.id, 'x', crypto.randomUUID(), 'agent')).rejects.toThrow('modificati dopo la verifica');
    expect((s.store.db.prepare('SELECT count(*) AS count FROM runs').get() as any).count).toBe(0);
    const fake = new RunManager(s.store, () => {}, async () => ({ sessionId: 's', completion: Promise.resolve(), stop: async () => {} }));
    await expect(fake.start(s.task.id, profile.id, 'x', crypto.randomUUID(), 'agent', undefined, 'extreme')).rejects.toThrow('Effort non supportato');
  });
});

describe('P06-I05 a finished turn is not a finished task', () => {
  it('P06-I05 each run is separated in the timeline and the final answer never completes the task', async () => {
    const s = await setup();
    const profile = await s.verified('codex', 'm');
    const runs = new RunManager(s.store, () => {}, async options => { options.onEvent({ kind: 'result', text: 'Tutto fatto, task completato!', payload: {} }); return { sessionId: 's', completion: Promise.resolve(), stop: async () => {} }; });
    for (const text of ['one', 'two']) {
      const run = await runs.start(s.task.id, profile.id, text, crypto.randomUUID(), 'agent') as any;
      for (let i = 0; i < 100 && (s.store.db.prepare('SELECT state FROM runs WHERE id=?').get(run.id) as any).state !== 'finished'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    }
    await runs.shutdown();
    const blocks = (await s.call('task/snapshot', { taskId: s.task.id })).blocks;
    expect(blocks.filter((block: any) => block.kind === 'run_state' && block.detail.state === 'finished')).toHaveLength(2);
    expect(new Set(blocks.filter((block: any) => block.kind === 'user').map((block: any) => block.run_id)).size).toBe(2);
    expect((await s.call('task/progress', { taskId: s.task.id })).status).not.toBe('completed');
  });
});

describe('P06-I06 failures name their cause and never trigger a spend', () => {
  const real: [string, string][] = [
    ['quota', 'You\'ve hit your usage limit. Upgrade or try again at 5:00 PM.'],
    ['quota', 'Claude AI usage limit reached|1760000000'],
    ['credit', '402 Insufficient credits. Add more using https://openrouter.ai/credits'],
    ['auth', '401 Incorrect API key provided: sk-****'],
    ['auth', 'Accesso codex non utilizzabile: Sessione scaduta'],
    ['network', 'getaddrinfo ENOTFOUND api.openai.com'],
    ['network', 'read ECONNRESET'],
    ['process', 'Claude terminato senza risultato (1)'],
    ['tool', 'Tool call failed: command failed with exit code 2'],
    ['model_missing', 'model "qwen3.5:4b" not found, try pulling it first'],
    ['server_unavailable', 'connect ECONNREFUSED 127.0.0.1:11434'],
  ];
  it.each(real)('P06-I06 classifies %s from a message of the real tools', (cause, message) => {
    expect(classifyFailure(message).cause).toBe(cause);
  });
  it('P06-I06 a credit failure ends one run with its cause and action, starts nothing else and keeps the files', async () => {
    const s = await setup();
    const profile = await s.verified('openrouter', 'm', 'https://openrouter.ai/api/v1');
    const runs = new RunManager(s.store, () => {}, async () => ({ sessionId: 's', completion: Promise.reject(new Error('402 Insufficient credits')), stop: async () => {} }));
    const run = await runs.start(s.task.id, profile.id, 'x', crypto.randomUUID(), 'agent') as any;
    for (let i = 0; i < 100 && (s.store.db.prepare('SELECT state FROM runs WHERE id=?').get(run.id) as any).state !== 'failed'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const state = (s.store.events(s.task.id) as any[]).filter(event => event.kind === 'run_state').at(-1).payload;
    expect(state).toMatchObject({ state: 'failed', cause: 'credit' });
    expect(state.action).toContain('nessuna spesa alternativa');
    expect((s.store.db.prepare('SELECT count(*) AS count FROM runs').get() as any).count).toBe(1);
    expect((s.store.db.prepare('SELECT count(*) AS count FROM handoffs').get() as any).count).toBe(0);
    await runs.shutdown();
  });
});
