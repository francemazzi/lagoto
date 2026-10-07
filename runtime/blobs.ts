import { readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Store } from './storage.js';

/** Every blob digest that a checkpoint manifest still references. */
export function referencedBlobs(store: Store): Set<string> {
  const used = new Set<string>();
  for (const row of store.db.prepare('SELECT manifest FROM checkpoints').iterate() as Iterable<{ manifest: string }>) {
    const manifest = JSON.parse(row.manifest) as { repositories?: { index?: string; entries?: { hash?: string }[]; objects?: { hash: string }[] }[] };
    for (const repository of manifest.repositories ?? []) {
      if (repository.index) used.add(repository.index);
      for (const entry of repository.entries ?? []) if (entry.hash) used.add(entry.hash);
      for (const object of repository.objects ?? []) used.add(object.hash);
    }
  }
  return used;
}

export type OrphanBlob = { hash: string; bytes: number; ageMs: number };
/** Blobs written by a checkpoint that never completed. Referenced blobs are never orphans. */
export async function orphanBlobs(store: Store, now = Date.now()): Promise<OrphanBlob[]> {
  const folder = join(store.directory, 'blobs');
  let names: string[] = [];
  try { names = await readdir(folder); } catch { return []; }
  const used = referencedBlobs(store); const result: OrphanBlob[] = [];
  for (const name of names) {
    if (!/^[a-f0-9]{64}$/.test(name) || used.has(name)) continue;
    const info = await stat(join(folder, name));
    result.push({ hash: name, bytes: info.size, ageMs: now - info.mtimeMs });
  }
  return result;
}

/** Remove orphans older than `minAgeMs` so a checkpoint still being written is never damaged. */
export async function removeOrphanBlobs(store: Store, options: { minAgeMs?: number; now?: number } = {}) {
  const minAge = options.minAgeMs ?? 10 * 60 * 1000;
  const orphans = (await orphanBlobs(store, options.now)).filter(blob => blob.ageMs >= minAge);
  for (const blob of orphans) await rm(join(store.directory, 'blobs', blob.hash), { force: true });
  return { removed: orphans.length, bytes: orphans.reduce((sum, blob) => sum + blob.bytes, 0) };
}
