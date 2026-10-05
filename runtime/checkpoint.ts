import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat, readlink, symlink, chmod, realpath } from 'node:fs/promises';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';
import { Store } from './storage.js';
import { git, type TaskRepository } from './git.js';
import { AppError, now } from './protocol.js';

type Entry = { path: string; hash?: string; mode?: number; symlink?: string; deleted?: true };
type RepositorySnapshot = { repositoryId: string; head: string; branch: string; index: string; entries: Entry[]; excluded: string[] };
export type Manifest = { version: 1; taskId: string; repositories: RepositorySnapshot[]; createdAt: string };
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
function safePath(root: string, path: string) {
  const target = resolve(root, path); const delta = relative(root, target);
  if (!delta || delta.startsWith('..') || isAbsolute(delta) || path.split('/').includes('.git')) throw new AppError(400, 'Percorso checkpoint non sicuro');
  return target;
}
const secretName = (path: string) => /(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|credentials\.json)$|\.(?:pem|p12|pfx|key)$/i.test(path);
const secretBytes = (data: Buffer) => /-----BEGIN [\w ]*PRIVATE KEY-----|\b(?:sk-[\w-]{20,}|ghp_[\w]{20,}|github_pat_[\w]{20,})/.test(data.toString('utf8'));
async function blob(store: Store, bytes: Buffer): Promise<string> {
  const digest = hash(bytes); const folder = join(store.directory, 'blobs'); await mkdir(folder, { recursive: true, mode: 0o700 });
  const path = join(folder, digest);
  try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); } catch (error: any) { if (error.code !== 'EEXIST') throw error; }
  if (hash(await readFile(path)) !== digest) throw new AppError(500, 'Artefatto corrotto'); return digest;
}
async function loadBlob(store: Store, digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new AppError(400, 'Hash artefatto invalido');
  const bytes = await readFile(join(store.directory, 'blobs', digest)); if (hash(bytes) !== digest) throw new AppError(500, 'Checksum artefatto non valido'); return bytes;
}
export async function fingerprint(directory: string) {
  const state = await git(directory, ['status', '--porcelain=v1', '-z']);
  const diff = await git(directory, ['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--']);
  const untracked = (await git(directory, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean).sort();
  const digests = await Promise.all(untracked.map(async path => { const absolute = safePath(directory, path); const stat = await lstat(absolute); return [path, stat.isSymbolicLink() ? hash(await readlink(absolute)) : hash(await readFile(absolute))]; }));
  return hash(JSON.stringify({ head: await git(directory, ['rev-parse', 'HEAD']), state, diff, digests }));
}
export async function createCheckpoint(store: Store, taskId: string) {
  store.task(taskId);
  if (store.db.prepare("SELECT id FROM runs WHERE task_id=? AND state IN ('starting','running','waiting_permission','stopping','unknown')").get(taskId)) throw new AppError(409, 'Arrestare e riconciliare i writer prima del checkpoint');
  const repositories = store.db.prepare('SELECT * FROM task_repositories WHERE task_id=? ORDER BY repository_id').all(taskId) as TaskRepository[];
  if (!repositories.length) throw new AppError(400, 'Nessun worktree preparato');
  const snapshots: RepositorySnapshot[] = [];
  const fingerprints: string[] = [];
  for (const repo of repositories) {
    const canonicalRoot = await realpath(repo.path);
    fingerprints.push(await fingerprint(repo.path));
    const names = (await git(repo.path, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
    const snapshot: RepositorySnapshot = { repositoryId: repo.repository_id, head: await git(repo.path, ['rev-parse', 'HEAD']), branch: repo.branch,
      index: '', entries: [], excluded: [] };
    const indexPath = await git(repo.path, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
    snapshot.index = await blob(store, await readFile(indexPath));
    for (const path of [...new Set(names)].sort()) {
      if (secretName(path)) { snapshot.excluded.push(path); continue; }
      const absolute = safePath(repo.path, path);
      try {
        const stat = await lstat(absolute);
        if (stat.isSymbolicLink()) {
          const target = await readlink(absolute);
          if (isAbsolute(target) || relative(repo.path, resolve(dirname(absolute), target)).startsWith('..')) { snapshot.excluded.push(path); continue; }
          snapshot.entries.push({ path, symlink: target });
        } else {
          // Refuse ancestor symlinks so a stored path cannot escape its authorized root.
          if (relative(canonicalRoot, await realpath(absolute)).startsWith('..')) { snapshot.excluded.push(path); continue; }
          const bytes = await readFile(absolute);
          if (secretBytes(bytes)) { snapshot.excluded.push(path); continue; }
          snapshot.entries.push({ path, hash: await blob(store, bytes), mode: stat.mode & 0o777 });
        }
      } catch (error: any) { if (error.code === 'ENOENT') snapshot.entries.push({ path, deleted: true }); else throw error; }
    }
    snapshots.push(snapshot);
  }
  for (let i = 0; i < repositories.length; i++) if (await fingerprint(repositories[i]!.path) !== fingerprints[i]) throw new AppError(409, 'File cambiati durante il checkpoint: riprovare dopo la riconciliazione');
  const manifest: Manifest = { version: 1, taskId, repositories: snapshots, createdAt: now() };
  const id = randomUUID(); store.db.prepare('INSERT INTO checkpoints VALUES(?,?,?,?)').run(id, taskId, JSON.stringify(manifest), manifest.createdAt);
  store.event(taskId, null, 'checkpoint', { id, excluded: snapshots.flatMap(r => r.excluded) });
  return { id, ...manifest };
}
export async function restoreCheckpoint(store: Store, checkpointId: string, destination: string) {
  const row = store.db.prepare('SELECT manifest FROM checkpoints WHERE id=?').get(checkpointId) as { manifest: string } | undefined;
  if (!row) throw new AppError(404, 'Checkpoint non trovato');
  const manifest = JSON.parse(row.manifest) as Manifest;
  // Validate all blob bytes before creating any destination.
  for (const repo of manifest.repositories) { await loadBlob(store, repo.index); for (const entry of repo.entries) if (entry.hash) await loadBlob(store, entry.hash); }
  await mkdir(destination, { recursive: false, mode: 0o700 });
  for (const repo of manifest.repositories) {
    const root = safePath(destination, repo.repositoryId); await mkdir(root);
    for (const entry of repo.entries) {
      const path = safePath(root, entry.path); if (entry.deleted) continue;
      await mkdir(dirname(path), { recursive: true });
      if (entry.symlink) {
        if (isAbsolute(entry.symlink) || relative(root, resolve(dirname(path), entry.symlink)).startsWith('..')) throw new AppError(400, 'Symlink non sicuro');
        await symlink(entry.symlink, path);
      } else if (entry.hash) { await writeFile(path, await loadBlob(store, entry.hash), { flag: 'wx' }); await chmod(path, entry.mode ?? 0o600); }
    }
    // Recovery is an isolated filesystem export; Git object/index restoration is separately gated.
    await writeFile(join(root, '.lagoto-index'), await loadBlob(store, repo.index), { mode: 0o600 });
  }
  return { destination, manifest, gitRestored: false };
}
export function contextPack(store: Store, taskId: string, maximumCharacters: number) {
  const task = store.task(taskId);
  const decisions = store.db.prepare("SELECT content FROM decisions WHERE task_id=? AND state='active' ORDER BY created_at,id").all(taskId);
  const checkpoint = store.db.prepare('SELECT id,manifest FROM checkpoints WHERE task_id=? ORDER BY created_at DESC LIMIT 1').get(taskId) as { id: string; manifest: string } | undefined;
  const verifications = store.db.prepare('SELECT command,state,fingerprint FROM verifications WHERE task_id=? ORDER BY created_at').all(taskId);
  const uncertain = store.db.prepare("SELECT kind,state,payload FROM external_actions WHERE task_id=? AND state='unknown'").all(taskId);
  const content = JSON.stringify({ version: 1, task: { title: task.title, objective: task.objective }, decisions, checkpoint: checkpoint ? { id: checkpoint.id, manifest: JSON.parse(checkpoint.manifest) } : null, verifications, uncertain }, null, 2);
  if (content.length > maximumCharacters) throw new AppError(413, 'Il nucleo obbligatorio non entra nel contesto: riduci il perimetro');
  return { content, hash: hash(content), estimated: true, characters: content.length, exclusions: checkpoint ? (JSON.parse(checkpoint.manifest) as Manifest).repositories.flatMap(r => r.excluded) : [] };
}
