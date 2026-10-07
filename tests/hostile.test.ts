import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { git } from '../runtime/git.js';
import { cleanup as cleanupGit } from './helpers/git-task.js';

const roots: string[] = []; const stores: Store[] = [];
afterEach(() => { cleanupGit(); for (const s of stores.splice(0)) { try { s.close(); } catch { /* closed */ } } for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

/** A repository whose configuration and hooks try to run code the moment Git touches it. Markers prove execution. */
async function hostileRepository() {
  const root = mkdtempSync(join(tmpdir(), 'lagoto-hostile-')); roots.push(root);
  const markers = join(root, 'markers'); mkdirSync(markers);
  const path = join(root, 'repo'); mkdirSync(path);
  const script = (name: string, tail = 'exit 0') => { const file = join(root, `${name}.sh`); writeFileSync(file, `#!/bin/sh\ntouch "${join(markers, name)}"\n${tail}\n`); chmodSync(file, 0o755); return file; };
  execFileSync('git', ['init', '-b', 'main'], { cwd: path });
  execFileSync('git', ['config', 'user.name', 'F'], { cwd: path }); execFileSync('git', ['config', 'user.email', 'f@example.invalid'], { cwd: path });
  writeFileSync(join(path, 'a.txt'), 'seed\n'); writeFileSync(join(path, '.gitattributes'), '*.txt diff=evil textconv=evil\n');
  execFileSync('git', ['add', '.'], { cwd: path }); execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: path });
  for (const hook of ['pre-commit', 'post-commit', 'post-checkout', 'pre-push', 'commit-msg', 'post-merge', 'reference-transaction']) { const file = join(path, '.git/hooks', hook); writeFileSync(file, `#!/bin/sh\ntouch "${join(markers, 'hook-' + hook)}"\nexit 0\n`); chmodSync(file, 0o755); }
  const fsmonitor = script('fsmonitor'), textconv = script('textconv', 'cat "$1"'), pager = script('pager'), ssh = script('ssh'), editor = script('editor');
  for (const [key, value] of ([['core.fsmonitor', fsmonitor], ['diff.evil.textconv', textconv], ['diff.external', script('extdiff')], ['core.pager', pager], ['core.sshCommand', ssh], ['core.editor', editor], ['core.hooksPath', join(path, '.git/hooks')],
    ['alias.status', `!sh ${script('alias')}`], ['credential.helper', `!sh ${script('credential')}`], ['filter.evil.clean', script('clean', 'cat')], ['filter.evil.smudge', script('smudge', 'cat')]] as [string, string][]))
    execFileSync('git', ['config', key, value], { cwd: path });
  writeFileSync(join(path, '.git/info/attributes'), '*.txt filter=evil\n');
  return { root, path, markers, executed: () => (existsSync(markers) ? execFileSync('ls', [markers], { encoding: 'utf8' }).split('\n').filter(Boolean) : []) };
}

describe('P12-I04 hostile repositories cannot make Lagoto execute their code', () => {
  it('P12-I04 hooks, fsmonitor, textconv, pager, ssh command, aliases and filters configured by a repository never run during add, prepare, diff, checkpoint and delivery', async () => {
    const h = await hostileRepository();
    const store = new Store(join(h.root, 'data')); stores.push(store); const service = new Service(store);
    const call = (method: string, params: Record<string, unknown> = {}) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
    const project = await call('project/create', { name: 'Hostile' });
    const repo = await call('repository/add', { projectId: project.id, path: h.path });
    await call('repository/inspect', { projectId: project.id, repositoryId: repo.id });
    const task = await call('task/create', { projectId: project.id, title: 'T' });
    const [work] = await call('task/prepare', { taskId: task.id, repositoryIds: [repo.id] });
    writeFileSync(join(work.path, 'a.txt'), 'changed\n');
    await call('task/diff', { taskId: task.id });
    await call('checkpoint/create', { taskId: task.id });
    const preview = await call('delivery/preview', { taskId: task.id, id: crypto.randomUUID(), message: 'Hostile commit', selections: [{ repositoryId: repo.id, paths: ['a.txt'] }] }).catch((error: Error) => ({ error: error.message }));
    void preview;
    await git(h.path, ['status', '--short']);
    expect(h.executed()).toEqual([]);
  });
  it('P12-I04 export refuses traversal through the destination and the manifest names, and a task title cannot escape the export folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lagoto-traversal-')); roots.push(root);
    const store = new Store(join(root, 'data')); stores.push(store); const service = new Service(store);
    const call = (method: string, params: Record<string, unknown> = {}) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
    const project = await call('project/create', { name: '../../escape' });
    const task = await call('task/create', { projectId: project.id, title: '../../../etc/passwd' });
    const preview = await call('task/export/preview', { taskId: task.id });
    await expect(call('task/export', { taskId: task.id, destination: 'relative/path', hash: preview.hash })).rejects.toThrow();
    const destination = join(root, 'out');
    await call('task/export', { taskId: task.id, destination, hash: preview.hash });
    expect(readFileSync(join(destination, 'task.json'), 'utf8')).toContain('../../../etc/passwd');
    expect(existsSync(join(root, 'etc'))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(destination, 'manifest.json'), 'utf8'));
    manifest.files.push({ name: '../escape.txt', bytes: 0, sha256: 'x' });
    writeFileSync(join(destination, 'manifest.json'), JSON.stringify(manifest));
    await expect(call('task/import', { projectId: project.id, source: destination })).rejects.toThrow();
    await expect(call('task/import', { projectId: project.id, source: 'relative' })).rejects.toThrow('assoluto');
  });
});
