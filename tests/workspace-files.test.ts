import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, gitTask } from './helpers/git-task.js';

afterEach(cleanup);
const outsideRoots: string[] = [];
afterEach(() => { for (const r of outsideRoots.splice(0)) rmSync(r, { recursive: true, force: true }); });

describe('P02-I07 explorer and preview read only what belongs to the task worktree', () => {
  it('P02-I07 lists a worktree sorted with folders first, hides .git, reports links without following them and caps the listing', async () => {
    const f = await gitTask({ files: { 'src/app.ts': 'export {}\n', 'README.md': '# T\n', 'docs/a.md': 'a' } });
    const outside = mkdtempSync(join(tmpdir(), 'lagoto-outside-')); outsideRoots.push(outside); writeFileSync(join(outside, 'secret.txt'), 'outside');
    symlinkSync(outside, join(f.work.path, 'link-out'));
    const root = await f.call('task/files', { taskId: f.task.id, repositoryId: f.repo.id });
    expect(root.entries.map((e: any) => `${e.kind}:${e.name}`)).toEqual(['dir:docs', 'dir:src', 'file:contract.json', 'symlink:link-out', 'file:README.md']);
    expect(root.entries.some((e: any) => e.name === '.git')).toBe(false);
    expect((await f.call('task/files', { taskId: f.task.id, repositoryId: f.repo.id, path: 'src' })).entries).toEqual([{ name: 'app.ts', kind: 'file', bytes: 10 }]);
    for (let i = 0; i < 2100; i++) writeFileSync(join(f.work.path, 'docs', `f${String(i).padStart(4, '0')}.txt`), 'x');
    const big = await f.call('task/files', { taskId: f.task.id, repositoryId: f.repo.id, path: 'docs' });
    expect(big.entries).toHaveLength(2000); expect(big.truncated).toBe(true);
  });
  it('P02-I07 refuses traversal, absolute paths, .git, links leaving the worktree and a repository outside the task', async () => {
    const f = await gitTask({ files: { 'a.txt': 'a' } });
    const outside = mkdtempSync(join(tmpdir(), 'lagoto-outside-')); outsideRoots.push(outside); writeFileSync(join(outside, 'secret.txt'), 'outside secret');
    symlinkSync(join(outside, 'secret.txt'), join(f.work.path, 'leak.txt')); symlinkSync(outside, join(f.work.path, 'leakdir'));
    const read = (path: string) => f.call('task/file', { taskId: f.task.id, repositoryId: f.repo.id, path });
    for (const path of ['../source/a.txt', '../../etc/passwd', '/etc/passwd', '.git/config', 'sub/../../x', 'leak.txt', 'leakdir/secret.txt', 'a.txt\0.png']) await expect(read(path), path).rejects.toThrow();
    await expect(f.call('task/files', { taskId: f.task.id, repositoryId: f.repo.id, path: 'leakdir' })).rejects.toThrow('esce dal worktree');
    await expect(f.call('task/files', { taskId: f.task.id, repositoryId: crypto.randomUUID() })).rejects.toThrow('esterno al task');
    await expect(read('missing.txt')).rejects.toThrow('non trovato');
    expect((await read('a.txt')).text).toBe('a');
  });
  it('P02-I07 reads text under a size cap, returns images as base64, detects binaries and returns HTML as inert text', async () => {
    const f = await gitTask({ files: { 'page.html': '<script>fetch("file:///etc/passwd")</script><h1>Ciao</h1>' } });
    writeFileSync(join(f.work.path, 'big.txt'), 'x'.repeat(3 * 1024 * 1024));
    writeFileSync(join(f.work.path, 'logo.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    writeFileSync(join(f.work.path, 'blob.dat'), Buffer.from([1, 2, 0, 3]));
    mkdirSync(join(f.work.path, 'dir'));
    const read = (path: string, maxBytes?: number) => f.call('task/file', { taskId: f.task.id, repositoryId: f.repo.id, path, ...(maxBytes ? { maxBytes } : {}) });
    expect(await read('page.html')).toMatchObject({ kind: 'text', language: 'html', base64: null, mime: null, truncated: false });
    expect((await read('page.html')).text).toContain('<script>');
    expect(await read('logo.png')).toMatchObject({ kind: 'image', mime: 'image/png', text: null, base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64') });
    expect(await read('blob.dat')).toMatchObject({ kind: 'binary', text: null, base64: null });
    const capped = await read('big.txt');
    expect(capped.truncated).toBe(true); expect(capped.text.length).toBe(2 * 1024 * 1024); expect(capped.bytes).toBe(3 * 1024 * 1024);
    expect((await read('big.txt', 10)).text).toBe('xxxxxxxxxx');
    await expect(read('dir')).rejects.toThrow('file regolare');
  });
});

describe('P02-I07 the changes tab can show the diff of one file', () => {
  it('P02-I07 returns a diff for a tracked change, additions for an untracked file, flags binaries and refuses paths outside the worktree', async () => {
    const f = await gitTask({ files: { 'a.txt': 'one\ntwo\n' } });
    writeFileSync(join(f.work.path, 'a.txt'), 'one\nTWO\n'); writeFileSync(join(f.work.path, 'new.txt'), 'brand\nnew\n'); writeFileSync(join(f.work.path, 'bin.dat'), Buffer.from([0, 1, 2]));
    const read = (path: string) => f.call('task/file/diff', { taskId: f.task.id, repositoryId: f.repo.id, path });
    expect(await read('a.txt')).toMatchObject({ tracked: true, binary: false });
    expect((await read('a.txt')).diff).toContain('-two'); expect((await read('a.txt')).diff).toContain('+TWO');
    expect(await read('new.txt')).toMatchObject({ tracked: false, binary: false, diff: expect.stringContaining('+brand') });
    expect(await read('bin.dat')).toMatchObject({ tracked: false, binary: true, diff: '' });
    await expect(read('../source/a.txt')).rejects.toThrow();
    await expect(read('.git/config')).rejects.toThrow();
  });
});
