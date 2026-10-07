import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { RunManager } from '../runtime/runs.js';
import { git } from '../runtime/git.js';

const roots: string[] = []; const stores: Store[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
async function fixture(prepare?: (path: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'lagoto-isolation-')); roots.push(root);
  const store = new Store(join(root, 'data')); stores.push(store); const service = new Service(store);
  const call = (method: string, params: Record<string, unknown> = {}) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
  const path = join(root, 'source'); mkdirSync(path);
  await git(path, ['init', '-b', 'main']); await git(path, ['config', 'user.name', 'Fixture']); await git(path, ['config', 'user.email', 'f@example.invalid']);
  writeFileSync(join(path, 'package.json'), '{"scripts":{"test":"exit 0"}}\n'); await git(path, ['add', '.']); await git(path, ['commit', '-m', 'one']);
  if (prepare) await prepare(path);
  const project = await call('project/create', { name: 'Isolation' });
  const repo = await call('repository/add', { projectId: project.id, path });
  const task = await call('task/create', { projectId: project.id, title: 'T' });
  return { root, store, service, call, path, project, repo, task };
}

describe('P04-I03 one writer per set of worktrees', () => {
  it('P04-I03 simultaneous run starts give ownership to exactly one request', async () => {
    const f = await fixture();
    await f.call('task/prepare', { taskId: f.task.id, repositoryIds: [f.repo.id] });
    const profile = await f.call('profile/create', { name: 'F', provider: 'codex', model: 'm' });
    f.store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run(JSON.stringify({ modes: ['agent'], efforts: [], verification: 'passed' }), profile.id);
    let launches = 0; let finish!: () => void; const completion = new Promise<void>(resolve => { finish = resolve; });
    const runs = new RunManager(f.store, () => {}, async () => { launches++; return { sessionId: 's', completion, stop: async () => {} }; });
    const results = await Promise.allSettled([1, 2, 3, 4].map(n => runs.start(f.task.id, profile.id, `p${n}`, crypto.randomUUID(), 'agent')));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected').every(r => /possiede|attiva|già/i.test(String((r as PromiseRejectedResult).reason?.message)))).toBe(true);
    for (let i = 0; i < 40 && launches < 1; i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(launches).toBe(1);
    finish(); await runs.shutdown();
  });
});

describe('P04-I05 environment commands', () => {
  it('P04-I05 stores declared install, build and test commands per repository without running them', async () => {
    const f = await fixture();
    expect(await f.call('repository/setup', { projectId: f.project.id, repositoryId: f.repo.id, commands: [{ kind: 'install', command: 'pnpm install' }, { kind: 'test', command: 'pnpm test' }] })).toEqual({ saved: 2 });
    const listed = (await f.call('repository/list', { projectId: f.project.id }))[0];
    expect(JSON.parse(listed.setup)).toEqual([{ kind: 'install', command: 'pnpm install' }, { kind: 'test', command: 'pnpm test' }]);
    await expect(f.call('repository/setup', { projectId: f.project.id, repositoryId: crypto.randomUUID(), commands: [] })).rejects.toThrow('non trovato');
    await expect(f.call('repository/setup', { projectId: f.project.id, repositoryId: f.repo.id, commands: [{ kind: 'deploy', command: 'x' }] })).rejects.toThrow();
  });
  it('P04-I05 separates a missing tool from a failing test and a passing run', async () => {
    const f = await fixture();
    const [work] = await f.call('task/prepare', { taskId: f.task.id, repositoryIds: [f.repo.id] });
    const run = async (command: string) => {
      const started = await f.call('verification/start', { taskId: f.task.id, repositoryId: f.repo.id, command });
      for (let i = 0; i < 200; i++) { const row = (await f.call('verification/list', { taskId: f.task.id })).find((v: any) => v.id === started.id); if (row && row.state !== 'running') return row.state; await new Promise(resolve => setTimeout(resolve, 25)); }
      throw new Error('verification did not finish');
    };
    expect(work.path).toBeTruthy();
    expect(await run('lagoto-tool-that-does-not-exist --version')).toBe('environment');
    expect(await run('exit 3')).toBe('failed');
    expect(await run('exit 0')).toBe('passed');
  });
});

describe('P04-I06 states that must block or invalidate instead of hiding a problem', () => {
  it('P04-I06 blocks detached HEAD, merge in progress, submodules and Git LFS with a reason', async () => {
    const detached = await fixture(async path => { await git(path, ['checkout', '--detach']); });
    await expect(detached.call('task/prepare', { taskId: detached.task.id, repositoryIds: [detached.repo.id] })).rejects.toThrow('HEAD scollegato');
    const merging = await fixture(async path => { await git(path, ['checkout', '-b', 'topic']); writeFileSync(join(path, 'a.txt'), 'x'); await git(path, ['add', '.']); await git(path, ['commit', '-m', 'topic']); await git(path, ['checkout', 'main']); writeFileSync(join(path, 'a.txt'), 'y'); await git(path, ['add', '.']); await git(path, ['commit', '-m', 'main']); await git(path, ['merge', 'topic']).catch(() => {}); });
    await expect(merging.call('task/prepare', { taskId: merging.task.id, repositoryIds: [merging.repo.id] })).rejects.toThrow('Merge, rebase');
    const lfs = await fixture(async path => { writeFileSync(join(path, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n'); await git(path, ['add', '.']); await git(path, ['commit', '-m', 'lfs']); });
    await expect(lfs.call('task/prepare', { taskId: lfs.task.id, repositoryIds: [lfs.repo.id] })).rejects.toThrow('LFS');
    const sub = await fixture(async path => { const other = path + '-sub'; mkdirSync(other); await git(other, ['init', '-b', 'main']); await git(other, ['config', 'user.name', 'F']); await git(other, ['config', 'user.email', 'f@example.invalid']); writeFileSync(join(other, 'x'), '1'); await git(other, ['add', '.']); await git(other, ['commit', '-m', 's']); await git(path, ['-c', 'protocol.file.allow=always', 'submodule', 'add', other, 'vendor']); await git(path, ['commit', '-m', 'submodule']); });
    await expect(sub.call('task/prepare', { taskId: sub.task.id, repositoryIds: [sub.repo.id] })).rejects.toThrow('Submodule');
  });
  it('P04-I06 invalidates a passing verification when an external editor changes the worktree', async () => {
    const f = await fixture();
    const [work] = await f.call('task/prepare', { taskId: f.task.id, repositoryIds: [f.repo.id] });
    const started = await f.call('verification/start', { taskId: f.task.id, repositoryId: f.repo.id, command: 'exit 0' });
    for (let i = 0; i < 200; i++) { const row = (await f.call('verification/list', { taskId: f.task.id })).find((v: any) => v.id === started.id); if (row.state === 'passed') break; await new Promise(resolve => setTimeout(resolve, 25)); }
    writeFileSync(join(work.path, 'external.txt'), 'edited outside Lagoto');
    const row = (await f.call('verification/list', { taskId: f.task.id })).find((v: any) => v.id === started.id);
    expect(row.state).toBe('stale');
  });
});
