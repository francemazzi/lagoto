import { createHash } from 'node:crypto';
import { readdir, stat, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Store } from './storage.js';
import { git, type TaskRepository } from './git.js';
import { AppError } from './protocol.js';
import { orphanBlobs, removeOrphanBlobs, referencedBlobs } from './blobs.js';

async function directoryBytes(path: string): Promise<number> {
  let total = 0;
  let names: string[] = [];
  try { names = await readdir(path); } catch { return 0; }
  for (const name of names) {
    const child = join(path, name); const info = await lstat(child);
    total += info.isDirectory() ? await directoryBytes(child) : info.size;
  }
  return total;
}

/** Disk use by category. Worktrees are reported with their cleanliness and are never a cleanup target. */
export async function storageUsage(store: Store) {
  const blobFolder = join(store.directory, 'blobs');
  const referenced = referencedBlobs(store);
  let referencedBytes = 0, blobCount = 0;
  try { for (const name of await readdir(blobFolder)) { blobCount++; if (referenced.has(name)) referencedBytes += (await stat(join(blobFolder, name))).size; } } catch { /* no blobs yet */ }
  const orphans = await orphanBlobs(store);
  const rows = store.db.prepare('SELECT * FROM task_repositories ORDER BY task_id,repository_id').all() as TaskRepository[];
  const worktrees = [];
  for (const row of rows) {
    let dirty: boolean | null = null;
    try { dirty = Boolean((await git(row.path, ['status', '--porcelain'])).trim()); } catch { dirty = null; }
    worktrees.push({ taskId: row.task_id, repositoryId: row.repository_id, bytes: await directoryBytes(row.path), dirty, protected: true });
  }
  return { database: (await stat(join(store.directory, 'lagoto.sqlite'))).size, blobs: { count: blobCount, referencedBytes, orphanBytes: orphans.reduce((sum, blob) => sum + blob.bytes, 0), orphanCount: orphans.length }, worktrees,
    note: 'I worktree non vengono mai eliminati automaticamente' };
}

export type CleanupOptions = { keepCheckpoints?: number; keepDays?: number; minOrphanAgeMs?: number; now?: number };

/** A cleanup plan: checkpoints that may go, checkpoints that are protected and why, and orphan blobs older than the grace period. */
export async function cleanupPlan(store: Store, options: CleanupOptions = {}) {
  const keepCheckpoints = Math.max(1, options.keepCheckpoints ?? 3), keepDays = options.keepDays ?? 30, now = options.now ?? Date.now();
  const rows = store.db.prepare('SELECT id,task_id,created_at FROM checkpoints ORDER BY task_id,created_at DESC,rowid DESC').all() as { id: string; task_id: string; created_at: string }[];
  const referenced = (id: string) => Boolean(store.db.prepare('SELECT 1 FROM handoffs WHERE checkpoint_id=?').get(id)) || Boolean(store.db.prepare("SELECT 1 FROM external_actions WHERE payload LIKE ?").get(`%${id}%`));
  const protectedCheckpoints: { id: string; taskId: string; reason: string }[] = []; const prunable: { id: string; taskId: string; createdAt: string }[] = [];
  const seen = new Map<string, number>();
  for (const row of rows) {
    const rank = (seen.get(row.task_id) ?? 0) + 1; seen.set(row.task_id, rank);
    const ageDays = (now - Date.parse(row.created_at)) / 86400000;
    if (rank === 1) protectedCheckpoints.push({ id: row.id, taskId: row.task_id, reason: 'ultimo checkpoint del task' });
    else if (rank <= keepCheckpoints) protectedCheckpoints.push({ id: row.id, taskId: row.task_id, reason: 'tra gli ultimi conservati' });
    else if (ageDays < keepDays) protectedCheckpoints.push({ id: row.id, taskId: row.task_id, reason: 'recente' });
    else if (referenced(row.id)) protectedCheckpoints.push({ id: row.id, taskId: row.task_id, reason: 'referenziato da un passaggio o da una consegna' });
    else prunable.push({ id: row.id, taskId: row.task_id, createdAt: row.created_at });
  }
  // Blobs that become orphans once the prunable checkpoints are gone are counted as reclaimable.
  const orphans = (await orphanBlobs(store, now)).filter(blob => blob.ageMs >= (options.minOrphanAgeMs ?? 10 * 60 * 1000));
  const plan = { prunableCheckpoints: prunable, protectedCheckpoints, orphanBlobs: orphans.map(blob => ({ hash: blob.hash, bytes: blob.bytes })), reclaimableBytes: orphans.reduce((sum, blob) => sum + blob.bytes, 0),
    worktrees: 'mai eliminati automaticamente' as const };
  return { ...plan, hash: createHash('sha256').update(JSON.stringify({ p: prunable.map(c => c.id), o: plan.orphanBlobs.map(b => b.hash), options: { keepCheckpoints, keepDays } })).digest('hex') };
}

export async function cleanupApply(store: Store, hash: string, options: CleanupOptions = {}) {
  const plan = await cleanupPlan(store, options);
  if (plan.hash !== hash) throw new AppError(409, 'Il piano è cambiato dopo l’anteprima: ripeti l’anteprima della pulizia');
  store.db.transaction(() => { for (const checkpoint of plan.prunableCheckpoints) store.db.prepare('DELETE FROM checkpoints WHERE id=?').run(checkpoint.id); })();
  const removed = await removeOrphanBlobs(store, { minAgeMs: options.minOrphanAgeMs ?? 10 * 60 * 1000, now: options.now });
  return { prunedCheckpoints: plan.prunableCheckpoints.length, removedBlobs: removed.removed, freedBytes: removed.bytes };
}
