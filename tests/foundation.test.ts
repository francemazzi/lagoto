import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { redact } from '../runtime/protocol.js';
import { git, githubIdentity } from '../runtime/git.js';

const directories: string[] = []; const stores: Store[] = [];
function temp() { const path = mkdtempSync(join(tmpdir(), 'lagoto-test-')); directories.push(path); return path; }
function setup() { const store = new Store(temp()); stores.push(store); return { store, service: new Service(store) }; }
async function call(service: Service, method: string, params: Record<string, unknown> = {}) { return service.handle({ jsonrpc: '2.0', id: 'test', method, params }) as Promise<any>; }
async function repository() {
  const path = temp(); await git(path, ['init']); await git(path, ['config', 'user.name', 'Lagoto Test']); await git(path, ['config', 'user.email', 'lagoto@example.invalid']);
  writeFileSync(join(path, 'contract.txt'), 'original\n'); await git(path, ['add', 'contract.txt']); await git(path, ['commit', '-m', 'fixture']); return path;
}
afterEach(() => { for (const store of stores.splice(0)) { try { store.close(); } catch {} } for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
describe('Native foundations', () => {
  it('P01-I02 rejects unknown methods and invalid input without writes', async () => {
    const { service } = setup(); await expect(call(service, 'shell/exec', { command: 'touch hacked' })).rejects.toThrow('Metodo non supportato');
    await expect(call(service, 'project/create', { name: '', extra: true })).rejects.toThrow(); expect(await call(service, 'project/list')).toEqual([]);
    await expect(call(service, 'run/start', { taskId: crypto.randomUUID(), profileId: crypto.randomUUID(), prompt: 'x', requestId: crypto.randomUUID(), mode: 'agent' })).rejects.toThrow();
    expect(service.store.db.prepare('SELECT count(*) AS count FROM runs').get()).toEqual({ count: 0 });
  });
  it('P01-I03 admits only one runtime owner and releases the database on clean exit', () => {
    const { store } = setup(); expect(() => new Store(store.directory)).toThrow('Archivio già aperto'); const directory = store.directory; store.close();
    const reopened = new Store(directory); stores.push(reopened); expect(reopened.db.prepare('SELECT count(*) AS count FROM runtime_owner').get()).toEqual({ count: 1 });
  });
  it('P01-I04 persists project and task through restart and preserves foreign keys', async () => {
    const { service, store } = setup(); const project = await call(service, 'project/create', { name: 'Progetto 🐕' });
    const task = await call(service, 'task/create', { projectId: project.id, title: 'Modifica contratto' }); const path = store.directory; store.close();
    const reopened = new Store(path); stores.push(reopened); const next = new Service(reopened);
    expect(await call(next, 'task/list', { projectId: project.id })).toMatchObject([{ id: task.id }]);
    await expect(call(next, 'task/create', { projectId: crypto.randomUUID(), title: 'Orfano' })).rejects.toThrow('Progetto non trovato');
  });
  it('P01-I06 redacts secrets and credential URLs without removing token counts', () => {
    expect(redact({ apiKey: 'private', input_tokens: 10, text: 'Bearer abcdef https://user:secret@example.org/a' })).toEqual({ apiKey: '[REDACTED]', input_tokens: 10, text: 'Bearer [REDACTED] https://[REDACTED]@example.org/a' });
  });
  it('P03-I01 archive retains tasks and files', async () => {
    const { store, service } = setup(); const p = await call(service, 'project/create', { name: 'Archive' });
    const task = await call(service, 'task/create', { projectId: p.id, title: 'Keep' }); await call(service, 'project/archive', { projectId: p.id });
    expect(await call(service, 'project/list')).toEqual([]); expect(store.task(task.id).title).toBe('Keep');
  });
  it('P03-I02 canonicalizes symlinks and subfolders but keeps separate clones', async () => {
    const { service } = setup(); const p = await call(service, 'project/create', { name: 'Roots' }); const path = await repository(); const link = join(temp(), 'alias'); symlinkSync(path, link);
    const first = await call(service, 'repository/add', { projectId: p.id, path }); const second = await call(service, 'repository/add', { projectId: p.id, path: link }); expect(first.id).toBe(second.id);
    expect(githubIdentity('git@github.com:Example/App.git')).toBe(githubIdentity('https://github.com/example/app'));
  });
  it('P04-I01/P04-I02 three worktrees preserve original staged and unstaged bytes', async () => {
    const { service } = setup(); const p = await call(service, 'project/create', { name: 'Three repos' }); const ids: string[] = []; const paths: string[] = [];
    for (let i = 0; i < 3; i++) { const path = await repository(); paths.push(path); writeFileSync(join(path, 'contract.txt'), 'staged\n'); await git(path, ['add', 'contract.txt']); writeFileSync(join(path, 'contract.txt'), 'unstaged\n'); ids.push((await call(service, 'repository/add', { projectId: p.id, path })).id); }
    const before = await Promise.all(paths.map(path => git(path, ['diff', '--cached'])));
    const task = await call(service, 'task/create', { projectId: p.id, title: 'Contract' });
    const worktrees = await call(service, 'task/prepare', { taskId: task.id, repositoryIds: ids }); expect(worktrees).toHaveLength(3);
    for (let i = 0; i < 3; i++) { expect(readFileSync(join(paths[i]!, 'contract.txt'), 'utf8')).toBe('unstaged\n'); expect(await git(paths[i]!, ['diff', '--cached'])).toBe(before[i]); }
  });
  it('P05-I02 journals source events idempotently', async () => {
    const { service, store } = setup(); const p = await call(service, 'project/create', { name: 'Journal' }); const task = await call(service, 'task/create', { projectId: p.id, title: 'Replay' });
    store.event(task.id, null, 'text', { text: 'hello' }, 'source-1'); store.event(task.id, null, 'text', { text: 'hello' }, 'source-1');
    expect(store.events(task.id)).toHaveLength(1);
  });
});
