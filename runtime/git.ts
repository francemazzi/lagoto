import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, mkdir, access } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './storage.js';
import { AppError, redact } from './protocol.js';

const execute = promisify(execFile);
export async function git(cwd: string, args: string[]) {
  const { stdout } = await execute('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, maxBuffer: 20 * 1024 * 1024, timeout: 30000,
    env: { HOME: process.env.HOME, PATH: process.env.PATH, LANG: 'en_US.UTF-8', GIT_TERMINAL_PROMPT: '0' },
  });
  // NUL-delimited paths and trailing whitespace in filenames are meaningful.
  return args.includes('-z') ? stdout : stdout.replace(/\n$/, '');
}
export function githubIdentity(remote: string): string | null {
  const match = remote.match(/^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i);
  return match?.[1]?.toLowerCase() ?? null;
}
export async function addRepository(store: Store, projectId: string, directory: string) {
  store.project(projectId);
  const canonical = await realpath(directory);
  let root: string | null = null;
  try { root = await realpath(await git(canonical, ['rev-parse', '--show-toplevel'])); } catch { /* Non-Git folders remain candidates. */ }
  const path = root ?? canonical;
  let remote: string | null = null;
  if (root) {
    const names = (await git(root, ['remote'])).split('\n').filter(Boolean);
    const identities = new Set<string>();
    for (const name of names) { const id = githubIdentity(await git(root, ['remote', 'get-url', name])); if (id) identities.add(id); }
    if (identities.size === 1) remote = `https://github.com/${[...identities][0]}`;
  }
  const id = randomUUID();
  store.db.prepare('INSERT OR IGNORE INTO repositories(id,project_id,name,path,git_root,remote) VALUES(?,?,?,?,?,?)')
    .run(id, projectId, basename(path), path, root, remote);
  return store.db.prepare('SELECT * FROM repositories WHERE project_id=? AND path=?').get(projectId, path);
}
export type TaskRepository = { task_id: string; repository_id: string; path: string; branch: string; base: string };
export async function prepareWorktrees(store: Store, taskId: string, repositoryIds: string[]) {
  const task = store.task(taskId);
  if (store.db.prepare('SELECT 1 FROM task_repositories WHERE task_id=?').get(taskId)) throw new AppError(409, 'Worktree già preparati');
  const unique = [...new Set(repositoryIds)];
  if (!unique.length) throw new AppError(400, 'Seleziona almeno un repository');
  const repos = unique.map(id => {
    const row = store.db.prepare('SELECT * FROM repositories WHERE id=? AND project_id=?').get(id, task.project_id) as { id: string; path: string; git_root: string | null } | undefined;
    if (!row?.git_root) throw new AppError(400, 'Repository non pronto o esterno al progetto');
    return row;
  });
  // Validate the entire set before changing any repository.
  for (const repo of repos) {
    await access(repo.path);
    await git(repo.path, ['rev-parse', '--verify', 'HEAD']);
    const unsupported = await git(repo.path, ['ls-files', '--stage']);
    if (unsupported.split('\n').some(line => line.startsWith('160000 '))) throw new AppError(400, 'Submodule: preparazione automatica non ancora supportata');
  }
  const prepared: TaskRepository[] = [];
  try {
    for (const repo of repos) {
      const base = await git(repo.path, ['rev-parse', 'HEAD']);
      const path = join(store.directory, 'worktrees', taskId, repo.id);
      await mkdir(join(store.directory, 'worktrees', taskId), { recursive: true });
      const branch = `codex/lagoto-${taskId.slice(0, 8)}`;
      await git(repo.path, ['worktree', 'add', '-b', branch, path, base]);
      prepared.push({ task_id: taskId, repository_id: repo.id, path, branch, base });
    }
    store.db.transaction(() => {
      for (const row of prepared) store.db.prepare('INSERT INTO task_repositories VALUES(@task_id,@repository_id,@path,@branch,@base)').run(row);
    })();
    return prepared;
  } catch (error) {
    // Preserve partially created worktrees and their identity for explicit recovery.
    store.event(taskId, null, 'preparation_failed', { prepared, message: String(redact(String(error))) });
    throw error;
  }
}
export async function diffs(store: Store, taskId: string) {
  store.task(taskId);
  const repos = store.db.prepare('SELECT * FROM task_repositories WHERE task_id=?').all(taskId) as TaskRepository[];
  return Promise.all(repos.map(async repo => ({ ...repo,
    status: await git(repo.path, ['status', '--short']),
    diff: await git(repo.path, ['diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--']),
  })));
}
