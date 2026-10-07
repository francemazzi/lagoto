import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { GitHubLinks } from '../runtime/github-link.js';
import { cleanEnvironment } from '../runtime/process.js';

const roots: string[] = []; const stores: Store[] = [];
afterEach(() => { for (const s of stores.splice(0)) { try { s.close(); } catch { /* closed */ } } for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
const temp = () => { const p = mkdtempSync(join(tmpdir(), 'lagoto-search-')); roots.push(p); return p; };

async function populated(directory = join(temp(), 'data')) {
  const store = new Store(directory); stores.push(store); const service = new Service(store);
  const call = (method: string, params: Record<string, unknown> = {}) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
  const project = await call('project/create', { name: 'Ricerca' });
  const task = await call('task/create', { projectId: project.id, title: 'Contratto API', objective: 'Allineare backend e frontend' });
  const other = await call('project/create', { name: 'Altro' }); const otherTask = await call('task/create', { projectId: other.id, title: 'Altro contratto' });
  store.event(task.id, null, 'user', { text: 'Per favore aggiorna il contratto con il campo identificativo' });
  await call('decision/save', { taskId: task.id, content: 'Il contratto usa identificativi stringa' });
  await call('criterion/edit', { taskId: task.id, content: 'Il contratto compila su tutti i client', reason: 'Requisito' });
  return { store, service, call, project, task, other, otherTask, directory };
}

describe('P03-I06 the history is readable and searchable without the network', () => {
  it('P03-I06 finds tasks, messages, decisions and criteria, scopes by project, escapes wildcards and limits results', async () => {
    const f = await populated();
    const all = await f.call('search/query', { query: 'contratto' });
    expect(new Set(all.hits.map((hit: any) => hit.kind))).toEqual(new Set(['task', 'message', 'decision', 'criterion']));
    expect(all.hits.every((hit: any) => hit.snippet.toLowerCase().includes('contratto'))).toBe(true);
    const scoped = await f.call('search/query', { query: 'contratto', projectId: f.project.id });
    expect(scoped.hits.every((hit: any) => hit.taskId === f.task.id)).toBe(true);
    expect((await f.call('search/query', { query: '100%' })).hits).toEqual([]);
    expect((await f.call('search/query', { query: 'c' })).hits).toEqual([]);
    expect((await f.call('search/query', { query: 'contratto', limit: 2 }))).toMatchObject({ limited: true });
    await expect(f.call('search/query', { query: 'x', projectId: crypto.randomUUID() })).rejects.toThrow('non trovato');
  });
  it('P03-I06 answers from the local archive while every external network connection is denied by the OS', async () => {
    const f = await populated();
    const directory = f.directory; f.store.close();
    const policy = '(version 1)(allow default)(deny network*)';
    const script = `
      import Database from 'better-sqlite3';
      import net from 'node:net';
      import { searchArchive } from './dist/runtime/search.js';
      const denied = await new Promise(resolve => { const s = net.connect(443, '1.1.1.1'); s.setTimeout(3000, () => { s.destroy(); resolve('timeout'); }); s.on('connect', () => { s.destroy(); resolve('connected'); }); s.on('error', e => resolve(e.code)); });
      const db = new Database(${JSON.stringify(join(directory, 'lagoto.sqlite'))}, { readonly: true });
      const result = searchArchive({ db }, 'identificativi');
      console.log(JSON.stringify({ denied, kinds: result.hits.map(h => h.kind), projects: db.prepare('SELECT count(*) AS n FROM projects').get().n }));`;
    const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, process.execPath, '--input-type=module', '-e', script], { cwd: process.cwd(), env: cleanEnvironment(), stdio: 'pipe' });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; });
    await new Promise(resolve => child.once('close', resolve));
    const result = JSON.parse(output.trim().split('\n').at(-1)!);
    expect(result.denied).toBe('EPERM');
    expect(result.kinds).toContain('decision');
    expect(result.projects).toBe(2);
  });
  it('P03-I06 reports a saved GitHub link that cannot be reconfirmed instead of presenting it as verified', async () => {
    const f = await populated();
    const repoPath = temp();
    const { git } = await import('../runtime/git.js');
    await git(repoPath, ['init', '-b', 'main']);
    const repo = await f.call('repository/add', { projectId: f.project.id, path: repoPath });
    const operation = { id: crypto.randomUUID(), projectId: f.project.id, repositoryId: repo.id, path: repoPath, owner: 'someone', accountId: 1, name: 'demo', remoteName: 'github', url: 'https://github.com/someone/demo.git', branch: 'main', head: 'x', fingerprint: 'x', hash: 'x', step: 'verified', files: [], commits: 1, history: '', unpublished: '' };
    f.store.db.prepare('INSERT INTO repository_operations VALUES(?,?,?,?,?,?,?,?)').run(operation.id, f.project.id, repo.id, 'github-link', 'completed', JSON.stringify(operation), new Date().toISOString(), new Date().toISOString());
    const offline = new GitHubLinks(f.store, async () => { throw new Error('dial tcp: lookup api.github.com: no such host'); });
    expect((await offline.listVerified(f.project.id, repo.id))[0]!.verification).toMatchObject({ state: 'unverifiable' });
    const online = new GitHubLinks(f.store, async () => JSON.stringify({ id: 1, full_name: 'someone/demo', private: true, owner: { login: 'someone' }, description: null }));
    expect((await online.listVerified(f.project.id, repo.id))[0]!.verification.state).toBe('verified');
    const gone = new GitHubLinks(f.store, async () => { throw Object.assign(new Error('Not Found (HTTP 404)'), { stderr: 'gh: Not Found (HTTP 404)' }); });
    expect((await gone.listVerified(f.project.id, repo.id))[0]!.verification.state).toBe('missing');
    expect(await f.call('github/list', { projectId: f.project.id, repositoryId: repo.id })).toHaveLength(1);
  });
});
