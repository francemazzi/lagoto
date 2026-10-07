import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../runtime/storage.js';
import { Service } from '../../runtime/service.js';
import { git } from '../../runtime/git.js';

const roots: string[] = []; const stores: Store[] = [];
export function cleanup() { for (const s of stores.splice(0)) { try { s.close(); } catch { /* already closed */ } } for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); }

/** A project with one real Git repository and a task whose worktree is prepared. Synthetic data only. */
export async function gitTask(options: { files?: Record<string, string> } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lagoto-gittask-')); roots.push(root);
  const store = new Store(join(root, 'data')); stores.push(store); const service = new Service(store);
  const call = (method: string, params: Record<string, unknown> = {}) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
  const path = join(root, 'source'); mkdirSync(path);
  await git(path, ['init', '-b', 'main']); await git(path, ['config', 'user.name', 'Fixture']); await git(path, ['config', 'user.email', 'f@example.invalid']);
  for (const [name, content] of Object.entries({ 'contract.json': '{"version":1}\n', ...(options.files ?? {}) })) { mkdirSync(join(path, name, '..'), { recursive: true }); writeFileSync(join(path, name), content); }
  await git(path, ['add', '.']); await git(path, ['commit', '-m', 'one']);
  const project = await call('project/create', { name: 'Fixture' });
  const repo = await call('repository/add', { projectId: project.id, path });
  const task = await call('task/create', { projectId: project.id, title: 'T', objective: 'Do the thing' });
  const [work] = await call('task/prepare', { taskId: task.id, repositoryIds: [repo.id] });
  const verify = async (command: string) => {
    const started = await call('verification/start', { taskId: task.id, repositoryId: repo.id, command });
    for (let i = 0; i < 200; i++) { const row = (await call('verification/list', { taskId: task.id })).find((v: any) => v.id === started.id); if (row && row.state !== 'running') return row; await new Promise(resolve => setTimeout(resolve, 25)); }
    throw new Error('verification did not finish');
  };
  return { root, store, service, call, path, project, repo, task, work: work as { path: string }, verify };
}
