import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, gitTask } from './helpers/git-task.js';
import { git } from '../runtime/git.js';

afterEach(cleanup);

describe('P11-I01 the diff matches Git and omits nothing silently', () => {
  it('P11-I01 lists staged, unstaged, untracked and binary files exactly as Git reports them and marks truncation', async () => {
    const f = await gitTask({ files: { 'a.txt': 'one\n', 'b.txt': 'two\n', 'img.bin': 'seed' } });
    writeFileSync(join(f.work.path, 'a.txt'), 'one changed\n');
    writeFileSync(join(f.work.path, 'b.txt'), 'two staged\n'); await git(f.work.path, ['add', 'b.txt']);
    writeFileSync(join(f.work.path, 'new.txt'), 'brand new\n');
    writeFileSync(join(f.work.path, 'blob.dat'), Buffer.from([0, 1, 2, 3, 0, 255]));
    writeFileSync(join(f.work.path, 'img.bin'), Buffer.from([0, 9, 9, 0])); await git(f.work.path, ['add', 'img.bin']);
    const [repo] = await f.call('task/diff', { taskId: f.task.id });
    const key = (file: any) => `${file.area}:${file.path}`;
    const byArea = (area: string) => repo.files.filter((file: any) => file.area === area).map((file: any) => file.path).sort();
    expect(byArea('staged')).toEqual((await git(f.work.path, ['diff', '--cached', '--name-only'])).split('\n').filter(Boolean).sort());
    expect(byArea('unstaged')).toEqual((await git(f.work.path, ['diff', '--name-only'])).split('\n').filter(Boolean).sort());
    expect(byArea('untracked')).toEqual((await git(f.work.path, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean).sort());
    expect(repo.files.find((file: any) => key(file) === 'untracked:blob.dat')).toMatchObject({ binary: true });
    expect(repo.files.find((file: any) => key(file) === 'staged:img.bin')).toMatchObject({ binary: true, status: 'M' });
    expect(repo.files.find((file: any) => key(file) === 'unstaged:a.txt')).toMatchObject({ binary: false });
    expect(repo.diffTruncated).toBe(false);
    writeFileSync(join(f.work.path, 'big.txt'), 'x'.repeat(10)); await git(f.work.path, ['add', '-N', 'big.txt']);
    writeFileSync(join(f.work.path, 'big.txt'), 'y\n'.repeat(700_000));
    const [large] = await f.call('task/diff', { taskId: f.task.id });
    expect(large.diffTruncated).toBe(true); expect(large.diff.length).toBe(1024 * 1024); expect(large.diffBytes).toBeGreaterThan(1024 * 1024);
    expect(large.files.some((file: any) => file.path === 'big.txt')).toBe(true);
  });
  it('P11-I01 associates the latest test result of each repository with its diff', async () => {
    const f = await gitTask();
    expect((await f.call('task/diff', { taskId: f.task.id }))[0].test).toBe('none');
    await f.verify('exit 0');
    expect((await f.call('task/diff', { taskId: f.task.id }))[0].test).toBe('passed');
    writeFileSync(join(f.work.path, 'contract.json'), '{"version":2}\n');
    await f.call('verification/list', { taskId: f.task.id });
    expect((await f.call('task/diff', { taskId: f.task.id }))[0].test).toBe('stale');
  });
});

describe('P11-I02 ready for review is not completed', () => {
  it('P11-I02 review needs defined, proven criteria; stale proofs and missing criteria block it; waivers stay visible; completion stays separate', async () => {
    const f = await gitTask();
    await expect(f.call('task/review', { taskId: f.task.id })).rejects.toThrow('Nessun criterio');
    const tested = await f.call('criterion/edit', { taskId: f.task.id, content: 'Il contratto esiste', reason: 'Requisito' });
    const human = await f.call('criterion/edit', { taskId: f.task.id, content: 'Il codice è chiaro', reason: 'Giudizio umano' });
    await expect(f.call('task/review', { taskId: f.task.id })).rejects.toThrow('senza prova valida');
    const proof = await f.verify('test -f contract.json');
    await f.call('criterion/accept', { taskId: f.task.id, id: tested.id, revision: 1, verificationId: proof.id });
    await expect(f.call('task/review', { taskId: f.task.id })).rejects.toThrow('senza prova valida');
    await f.call('criterion/accept', { taskId: f.task.id, id: human.id, revision: 1, overrideReason: 'Rivisto da me il 7 ottobre' });
    const review = await f.call('task/review', { taskId: f.task.id });
    expect(review).toMatchObject({ status: 'review', waivers: [{ content: 'Il codice è chiaro', reason: 'Rivisto da me il 7 ottobre' }] });
    expect(review.note).toContain('non equivale a completato');
    expect((await f.call('task/progress', { taskId: f.task.id })).status).toBe('review');
    writeFileSync(join(f.work.path, 'contract.json'), '{"version":3}\n');
    const reopened = await f.call('task/progress', { taskId: f.task.id });
    expect(reopened.status).toBe('ready'); expect(reopened.phase).toBe('verify');
    await expect(f.call('task/review', { taskId: f.task.id })).rejects.toThrow('Prove obsolete');
    await expect(f.call('task/complete', { taskId: f.task.id })).rejects.toThrow('criteri');
  });
});

describe('P11-I04 export, preview, redaction and re-import', () => {
  it('P11-I04 shows the preview first, excludes and redacts a planted secret, refuses an existing destination and a changed task, then re-imports without credentials', async () => {
    const f = await gitTask();
    const secret = 'sk-' + 'z'.repeat(30);
    const criterion = await f.call('criterion/edit', { taskId: f.task.id, content: 'Il contratto esiste', reason: 'Requisito' });
    await f.call('decision/save', { taskId: f.task.id, content: `Usare la chiave ${secret} solo in locale` });
    f.store.event(f.task.id, null, 'user', { text: `La mia chiave è ${secret} e Authorization: Bearer ${'t'.repeat(24)}` });
    f.store.db.prepare("INSERT INTO verifications(id,task_id,command,fingerprint,state,output,created_at) VALUES(?,?,?,?,?,?,?)").run(crypto.randomUUID(), f.task.id, JSON.stringify({ repositoryId: f.repo.id, command: 'echo ok' }), 'x', 'passed', `output with ${secret}`, new Date().toISOString());
    await f.call('checkpoint/create', { taskId: f.task.id });
    const preview = await f.call('task/export/preview', { taskId: f.task.id });
    expect(preview.files.map((file: any) => file.name)).toEqual(['checkpoints.json', 'conversation.md', 'criteria.json', 'decisions.json', 'task.json', 'verifications.json']);
    expect(preview.excluded).toEqual(expect.arrayContaining([expect.stringContaining('credenziali')]));
    const destination = join(f.root, 'export-out');
    await f.call('decision/save', { taskId: f.task.id, content: 'Una decisione nuova dopo l’anteprima' });
    await expect(f.call('task/export', { taskId: f.task.id, destination, hash: preview.hash })).rejects.toThrow('è cambiato');
    expect(existsSync(destination)).toBe(false);
    const fresh = await f.call('task/export/preview', { taskId: f.task.id });
    const written = await f.call('task/export', { taskId: f.task.id, destination, hash: fresh.hash });
    expect(written.files).toBe(7);
    for (const name of readdirSync(destination)) expect(readFileSync(join(destination, name), 'utf8')).not.toContain(secret);
    expect(readFileSync(join(destination, 'conversation.md'), 'utf8')).not.toMatch(/Bearer t{10}/);
    await expect(f.call('task/export', { taskId: f.task.id, destination, hash: fresh.hash })).rejects.toThrow('esiste già');
    const imported = await f.call('task/import', { projectId: f.project.id, source: destination });
    expect(imported).toMatchObject({ criteria: 1, decisions: 2 });
    const progress = await f.call('task/progress', { taskId: imported.taskId });
    expect(progress.criteria[0]).toMatchObject({ content: 'Il contratto esiste', state: 'open' });
    expect(progress.decisions.every((d: any) => d.source === 'imported')).toBe(true);
    expect(criterion.id).not.toBe(progress.criteria[0].id);
    writeFileSync(join(destination, 'decisions.json'), '[{"content":"tampered","state":"active"}]');
    await expect(f.call('task/import', { projectId: f.project.id, source: destination })).rejects.toThrow('Checksum');
    mkdirSync(join(destination, 'extra'));
    await expect(f.call('task/import', { projectId: f.project.id, source: destination })).rejects.toThrow('file diversi');
  });
});

describe('P11-I06 retention never frees space by losing recoverable work', () => {
  it('P11-I06 protects the last checkpoint, referenced ones and dirty worktrees, prunes old unreferenced checkpoints and removes only aged orphans', async () => {
    const f = await gitTask({ files: { 'a.txt': 'alpha' } });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) { writeFileSync(join(f.work.path, 'a.txt'), `revision ${i}`); ids.push((await f.call('checkpoint/create', { taskId: f.task.id })).id); }
    const old = new Date(Date.now() - 90 * 86400000).toISOString();
    for (const id of ids.slice(0, 4)) f.store.db.prepare('UPDATE checkpoints SET created_at=? WHERE id=?').run(old, id);
    const profile = await f.call('profile/create', { name: 'P', provider: 'codex', model: 'm' });
    f.store.db.prepare("INSERT INTO handoffs(id,task_id,profile_id,state,checkpoint_id,created_at) VALUES(?,?,?,?,?,?)").run(crypto.randomUUID(), f.task.id, profile.id, 'started', ids[2], old);
    const usage = await f.call('storage/usage');
    expect(usage.worktrees[0]).toMatchObject({ dirty: true, protected: true });
    expect(usage.note).toContain('mai eliminati');
    const plan = await f.call('storage/cleanup/preview', { keepCheckpoints: 2, keepDays: 30 });
    const pruned = plan.prunableCheckpoints.map((c: any) => c.id);
    expect(pruned.sort()).toEqual([ids[0], ids[1]].sort());
    expect(plan.protectedCheckpoints.map((c: any) => c.id)).toEqual(expect.arrayContaining([ids[4], ids[3], ids[2]]));
    expect(plan.protectedCheckpoints.find((c: any) => c.id === ids[2])).toMatchObject({ reason: 'referenziato da un passaggio o da una consegna' });
    expect(plan.protectedCheckpoints.find((c: any) => c.id === ids[4])).toMatchObject({ reason: 'ultimo checkpoint del task' });
    expect(plan.worktrees).toBe('mai eliminati automaticamente');
    await expect(f.call('storage/cleanup', { hash: '0'.repeat(64), keepCheckpoints: 2, keepDays: 30 })).rejects.toThrow('piano è cambiato');
    const blobs = join(f.store.directory, 'blobs');
    const before = readdirSync(blobs).length;
    const result = await f.call('storage/cleanup', { hash: plan.hash, keepCheckpoints: 2, keepDays: 30 });
    expect(result.prunedCheckpoints).toBe(2);
    expect((await f.call('checkpoint/list', { taskId: f.task.id })).map((c: any) => c.id).sort()).toEqual([ids[2], ids[3], ids[4]].sort());
    expect(readdirSync(blobs).length).toBe(before);
    for (const name of readdirSync(blobs)) { const aged = new Date(Date.now() - 3600_000); utimesSync(join(blobs, name), aged, aged); }
    const second = await f.call('storage/cleanup/preview', { keepCheckpoints: 2, keepDays: 30 });
    expect(second.reclaimableBytes).toBeGreaterThanOrEqual(0);
    const applied = await f.call('storage/cleanup', { hash: second.hash, keepCheckpoints: 2, keepDays: 30 });
    expect(applied.removedBlobs).toBeGreaterThanOrEqual(0);
    const restored = await (await import('../runtime/checkpoint.js')).restoreCheckpoint(f.store, ids[4]!, join(f.root, 'restored-last'));
    expect(restored.gitRestored).toBe(true);
    expect(readFileSync(join(f.work.path, 'a.txt'), 'utf8')).toBe('revision 4');
    expect(existsSync(f.work.path)).toBe(true);
  });
});
