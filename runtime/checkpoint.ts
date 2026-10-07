import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat, readlink, symlink, chmod, realpath } from 'node:fs/promises';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';
import { Store } from './storage.js';
import { git, gitBytes, type TaskRepository } from './git.js';
import { AppError, now } from './protocol.js';
import { deflateSync } from 'node:zlib';
import { childResults } from './children.js';

type Entry = { path: string; hash?: string; mode?: number; symlink?: string; deleted?: true };
type GitObject = {oid:string;hash:string};
type RepositorySnapshot = { repositoryId: string; head: string; branch: string; index: string; entries: Entry[]; excluded: string[]; objects?:GitObject[]; objectFormat?:string; fingerprint?:string; changes?:string[] };
export type Manifest = { version: 1 | 2; taskId: string; repositories: RepositorySnapshot[]; createdAt: string };
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
  return hash(JSON.stringify({ head: await git(directory, ['rev-parse', 'HEAD']), state, diff, digests, index:await git(directory,['ls-files','--stage','-z']) }));
}
export async function createCheckpoint(store: Store, taskId: string, stoppedRunId?:string) {
  store.task(taskId);
  // stoppedRunId is supplied only by RunManager after stop() proved process cessation;
  // its DB ownership stays held until the snapshot is complete.
  if (store.db.prepare("SELECT id FROM runs WHERE task_id=? AND id<>COALESCE(?,'') AND state IN ('starting','running','waiting_permission','stopping','unknown')").get(taskId,stoppedRunId??null)) throw new AppError(409, 'Arrestare e riconciliare i writer prima del checkpoint');
  if(store.db.prepare("SELECT 1 FROM verifications WHERE task_id=? AND state IN ('running','unknown')").get(taskId))throw new AppError(409,'Arrestare e riconciliare la verifica prima del checkpoint');
  const repositories = store.db.prepare('SELECT * FROM task_repositories WHERE task_id=? ORDER BY repository_id').all(taskId) as TaskRepository[];
  if (!repositories.length) throw new AppError(400, 'Nessun worktree preparato');
  const snapshots: RepositorySnapshot[] = [];
  const fingerprints: string[] = [];
  for (const repo of repositories) {
    const canonicalRoot = await realpath(repo.path);
    fingerprints.push(await fingerprint(repo.path));
    const names = (await git(repo.path, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
    const snapshot: RepositorySnapshot = { repositoryId: repo.repository_id, head: await git(repo.path, ['rev-parse', 'HEAD']), branch: repo.branch,
      index: '', entries: [], excluded: [], objects:[], objectFormat:await git(repo.path,['rev-parse','--show-object-format']),fingerprint:fingerprints.at(-1) };
    snapshot.changes=[...new Set([...(await git(repo.path,['diff','--name-only','-z','HEAD','--'])).split('\0'),...(await git(repo.path,['ls-files','--others','--exclude-standard','-z'])).split('\0')].filter(Boolean))].sort();
    // The reachable object graph plus index-only blobs makes recovery independent of the original clone.
    // A secret detected in tracked history blocks Git recovery rather than hiding it inside an archive.
    const staged = (await git(repo.path,['ls-files','--stage','-z'])).split('\0').filter(Boolean);
    if(staged.some(line=>line.startsWith('160000 ') || secretName(line.slice(line.indexOf('\t')+1))))
      throw new AppError(409,'Checkpoint Git bloccato: submodule o file sensibile nello staging');
    const objectIds = new Set((await git(repo.path,['rev-list','--objects','--no-object-names','HEAD'])).split('\n').filter(Boolean));
    for(const line of staged) {const id=line.split(' ')[1];if(id && !/^0+$/.test(id))objectIds.add(id);}
    const split = await git(repo.path,['rev-parse','--shared-index-path']);
    if(split)throw new AppError(409,'Indice Git condiviso non supportato nel checkpoint');
    for(const oid of [...objectIds].sort()) {
      const type=await git(repo.path,['cat-file','-t',oid]); const bytes=await gitBytes(repo.path,['cat-file',type,oid]);
      if(secretBytes(bytes))throw new AppError(409,'Checkpoint Git bloccato: segreto rilevato nella cronologia o nello staging');
      if(type==='tree') {
        let offset=0;
        while(offset<bytes.length){const space=bytes.indexOf(32,offset),zero=bytes.indexOf(0,space);if(space<0||zero<0)throw new AppError(500,'Oggetto Git invalido');
          if(secretName(bytes.subarray(space+1,zero).toString()))throw new AppError(409,'Checkpoint Git bloccato: file sensibile nella cronologia');
          offset=zero+1+(snapshot.objectFormat==='sha256'?32:20);
        }
      }
      const object=Buffer.concat([Buffer.from(`${type} ${bytes.length}\0`),bytes]);
      if(createHash(snapshot.objectFormat!).update(object).digest('hex')!==oid)throw new AppError(500,'Checksum oggetto Git non valido');
      snapshot.objects!.push({oid,hash:await blob(store,object)});
    }
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
  const manifest: Manifest = { version: 2, taskId, repositories: snapshots, createdAt: now() };
  const id = randomUUID(); store.db.prepare('INSERT INTO checkpoints VALUES(?,?,?,?)').run(id, taskId, JSON.stringify(manifest), manifest.createdAt);
  store.event(taskId, null, 'checkpoint', { id, excluded: snapshots.flatMap(r => r.excluded) });
  return { id, ...manifest };
}
/** What changed in the worktrees since the latest complete checkpoint. Reports; never rolls anything back. */
export async function changesSince(store: Store, taskId: string) {
  store.task(taskId);
  const row = store.db.prepare('SELECT id,manifest,created_at FROM checkpoints WHERE task_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(taskId) as { id: string; manifest: string; created_at: string } | undefined;
  if (!row) return { checkpointId: null, changed: false, repositories: [] as { repositoryId: string; changed: boolean; paths: string[] }[] };
  const manifest = JSON.parse(row.manifest) as Manifest;
  const rows = store.db.prepare('SELECT * FROM task_repositories WHERE task_id=? ORDER BY repository_id').all(taskId) as TaskRepository[];
  const repositories: { repositoryId: string; changed: boolean; paths: string[] }[] = [];
  for (const repo of rows) {
    const snapshot = manifest.repositories.find(item => item.repositoryId === repo.repository_id);
    const changed = !snapshot || snapshot.fingerprint !== await fingerprint(repo.path);
    const paths = changed ? (await git(repo.path, ['status', '--porcelain=v1', '-z'])).split('\0').filter(Boolean).map(line => line.slice(3)).sort() : [];
    repositories.push({ repositoryId: repo.repository_id, changed, paths });
  }
  return { checkpointId: row.id, createdAt: row.created_at, changed: repositories.some(item => item.changed), repositories };
}
export async function restoreCheckpoint(store: Store, checkpointId: string, destination: string) {
  const row = store.db.prepare('SELECT manifest FROM checkpoints WHERE id=?').get(checkpointId) as { manifest: string } | undefined;
  if (!row) throw new AppError(404, 'Checkpoint non trovato');
  const manifest = JSON.parse(row.manifest) as Manifest;
  // Validate all blob bytes before creating any destination.
  for (const repo of manifest.repositories) {
    safePath(destination,repo.repositoryId);
    if(manifest.version===2 && (!repo.objects?.length || !['sha1','sha256'].includes(repo.objectFormat!)))throw new AppError(400,'Manifest Git incompleto');
    await loadBlob(store, repo.index);
    for(const object of repo.objects??[]){if(!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(object.oid) || createHash(repo.objectFormat!).update(await loadBlob(store,object.hash)).digest('hex')!==object.oid)throw new AppError(500,'Oggetto Git corrotto');}
    for (const entry of repo.entries) {safePath(join(destination,repo.repositoryId),entry.path);if (entry.hash) await loadBlob(store, entry.hash);}
  }
  await mkdir(destination, { recursive: false, mode: 0o700 });
  for (const repo of manifest.repositories) {
    const root = safePath(destination, repo.repositoryId); await mkdir(root);
    if(manifest.version===2) {
      await git(root,['init','--template=','--object-format='+repo.objectFormat]);
      for(const object of repo.objects!) {
        const folder=join(root,'.git','objects',object.oid.slice(0,2));await mkdir(folder,{recursive:true});
        await writeFile(join(folder,object.oid.slice(2)),deflateSync(await loadBlob(store,object.hash)),{flag:'wx',mode:0o600});
      }
      await git(root,['check-ref-format',`refs/heads/${repo.branch}`]);
      await git(root,['update-ref',`refs/heads/${repo.branch}`,repo.head]);await git(root,['symbolic-ref','HEAD',`refs/heads/${repo.branch}`]);
    }
    for (const entry of repo.entries) {
      const path = safePath(root, entry.path); if (entry.deleted) continue;
      await mkdir(dirname(path), { recursive: true });
      if (entry.symlink) {
        if (isAbsolute(entry.symlink) || relative(root, resolve(dirname(path), entry.symlink)).startsWith('..')) throw new AppError(400, 'Symlink non sicuro');
        await symlink(entry.symlink, path);
      } else if (entry.hash) { await writeFile(path, await loadBlob(store, entry.hash), { flag: 'wx' }); await chmod(path, entry.mode ?? 0o600); }
    }
    await writeFile(join(root, manifest.version===2?'.git/index':'.lagoto-index'), await loadBlob(store, repo.index), { mode: 0o600 });
    if(manifest.version===2)await git(root,['fsck','--no-reflogs']);
  }
  return { destination, manifest, gitRestored: manifest.version===2 };
}
export function contextPack(store: Store, taskId: string, maximumCharacters: number) {
  const task = store.task(taskId);
  const decisions = store.db.prepare("SELECT content,source,revision FROM decisions WHERE task_id=? AND state='active' ORDER BY created_at,id").all(taskId);
  const criteria=store.db.prepare('SELECT content,revision,state,verification_id,override_reason FROM criteria WHERE task_id=? ORDER BY created_at,id').all(taskId);
  const checkpoint = store.db.prepare('SELECT id,manifest FROM checkpoints WHERE task_id=? ORDER BY created_at DESC LIMIT 1').get(taskId) as { id: string; manifest: string } | undefined;
  const verifications = store.db.prepare('SELECT command,state,fingerprint FROM verifications WHERE task_id=? ORDER BY created_at').all(taskId);
  const uncertain = store.db.prepare("SELECT kind,state,payload FROM external_actions WHERE task_id=? AND state='unknown'").all(taskId);
  const repositories=store.db.prepare('SELECT tr.repository_id,tr.path,r.name FROM task_repositories tr JOIN repositories r ON r.id=tr.repository_id WHERE task_id=? ORDER BY r.name').all(taskId);
  const recent=store.db.prepare("SELECT kind,text FROM transcript WHERE task_id=? AND kind IN ('user','text') ORDER BY first_seq DESC LIMIT 12").all(taskId).reverse();
  const total=(store.db.prepare("SELECT count(*) AS n FROM transcript WHERE task_id=? AND kind IN ('user','text')").get(taskId) as {n:number}).n;
  const compact=checkpoint?JSON.parse(checkpoint.manifest) as Manifest:null;
  const core={ version: 2, task: { title: task.title, objective: task.objective }, repositories, decisions,criteria,
    checkpoint: compact ? {id:checkpoint!.id,createdAt:compact.createdAt,repositories:compact.repositories.map(r=>({repositoryId:r.repositoryId,head:r.head,branch:r.branch,index:r.index,entries:r.entries.filter(e=>!r.changes||r.changes.includes(e.path)),excluded:r.excluded,fingerprint:r.fingerprint}))} : null,
    historyIsReadOnly:true,verifications, uncertain, children: childResults(store.db,taskId) };
  const render=()=>JSON.stringify({...core,recentConversation:recent,conversationOmissions:Math.max(0,total-recent.length)},null,2);
  let content=render();
  while(content.length>maximumCharacters&&recent.length){recent.shift();content=render();}
  if (content.length > maximumCharacters) throw new AppError(413, 'Il nucleo obbligatorio non entra nel contesto: riduci il perimetro');
  return { content, hash: hash(content), estimated: true, characters: content.length, exclusions: checkpoint ? (JSON.parse(checkpoint.manifest) as Manifest).repositories.flatMap(r => r.excluded) : [] };
}
