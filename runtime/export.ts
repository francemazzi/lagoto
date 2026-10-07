import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, access } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import type { Store } from './storage.js';
import { AppError, now, redact } from './protocol.js';
import { APP_VERSION } from './version.js';

type FileEntry = { name: string; bytes: number; sha256: string };
export type ExportManifest = { version: 1; app: string; createdAt: string; task: { title: string }; files: FileEntry[]; excluded: string[] };
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const EXCLUDED = ['credenziali e chiavi API', 'eventi grezzi dei provider', 'contenuto dei file e blob dei checkpoint', 'percorsi assoluti dei worktree'];
const clip = (text: string, limit = 20000) => text.length > limit ? text.slice(0, limit) + '\n[troncato]' : text;

/** Build the readable export of a task in memory; nothing is written until the user confirms the preview. */
export function buildExport(store: Store, taskId: string) {
  const task = store.task(taskId);
  const files = new Map<string, string>();
  const json = (value: unknown) => JSON.stringify(redact(value), null, 2) + '\n';
  files.set('task.json', json({ title: task.title, objective: task.objective, status: task.status }));
  const criteria = store.db.prepare('SELECT id,content,revision,state,override_reason FROM criteria WHERE task_id=? ORDER BY created_at,id').all(taskId);
  const history = store.db.prepare('SELECT h.criterion_id,h.revision,h.content,h.reason,h.created_at FROM criteria_history h JOIN criteria c ON c.id=h.criterion_id WHERE c.task_id=? ORDER BY h.created_at,h.revision').all(taskId);
  files.set('criteria.json', json({ criteria, history }));
  files.set('decisions.json', json(store.db.prepare('SELECT id,content,state,source,revision,supersedes,created_at FROM decisions WHERE task_id=? ORDER BY created_at,id').all(taskId)));
  const verifications = (store.db.prepare('SELECT id,command,state,output,created_at FROM verifications WHERE task_id=? ORDER BY created_at').all(taskId) as { command: string; output: string }[])
    .map(row => { const command = JSON.parse(row.command); const repo = store.db.prepare('SELECT name FROM repositories WHERE id=?').get(command.repositoryId) as { name: string } | undefined; return { ...row, command: command.command, repository: repo?.name ?? null, output: clip(row.output) }; });
  files.set('verifications.json', json(verifications));
  files.set('checkpoints.json', json((store.db.prepare('SELECT id,manifest,created_at FROM checkpoints WHERE task_id=? ORDER BY created_at').all(taskId) as { id: string; manifest: string; created_at: string }[])
    .map(row => ({ id: row.id, createdAt: row.created_at, repositories: (JSON.parse(row.manifest).repositories ?? []).map((r: any) => ({ repositoryId: r.repositoryId, head: r.head, branch: r.branch, files: r.entries?.length ?? 0, excluded: r.excluded?.length ?? 0 })) }))));
  const conversation = (store.db.prepare("SELECT kind,text FROM transcript WHERE task_id=? AND kind IN ('user','text') ORDER BY first_seq").all(taskId) as { kind: string; text: string }[])
    .map(block => `### ${block.kind === 'user' ? 'Utente' : 'Modello'}\n\n${String(redact(clip(block.text, 50000)))}\n`).join('\n');
  files.set('conversation.md', `# ${String(redact(task.title))}\n\n${conversation}`);
  const entries: FileEntry[] = [...files.entries()].map(([name, content]) => ({ name, bytes: Buffer.byteLength(content), sha256: sha(content) })).sort((a, b) => a.name.localeCompare(b.name));
  const manifest: ExportManifest = { version: 1, app: APP_VERSION, createdAt: now(), task: { title: String(redact(task.title)) }, files: entries, excluded: EXCLUDED };
  const hash = sha(JSON.stringify({ entries, task: manifest.task }));
  return { files, manifest, hash };
}

export function exportPreview(store: Store, taskId: string) {
  const { manifest, hash } = buildExport(store, taskId);
  return { hash, files: manifest.files, excluded: manifest.excluded };
}

export async function exportTask(store: Store, taskId: string, destination: string, hash: string) {
  if (!isAbsolute(destination)) throw new AppError(400, 'Destinazione assoluta richiesta');
  try { await access(destination); throw new AppError(409, 'La destinazione esiste già: scegli una nuova cartella'); } catch (error) { if (error instanceof AppError) throw error; }
  const built = buildExport(store, taskId);
  if (built.hash !== hash) throw new AppError(409, 'Il lavoro è cambiato dopo l’anteprima: ripeti l’anteprima dell’export');
  await mkdir(destination, { recursive: false, mode: 0o700 });
  for (const [name, content] of built.files) await writeFile(join(destination, name), content, { flag: 'wx', mode: 0o600 });
  await writeFile(join(destination, 'manifest.json'), JSON.stringify(built.manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { destination, files: built.manifest.files.length + 1 };
}

/** Re-import an export into a project as a new task. Proofs never transfer; criteria reopen and decisions are marked imported. */
export async function importTask(store: Store, projectId: string, source: string) {
  if (!isAbsolute(source)) throw new AppError(400, 'Percorso assoluto richiesto');
  store.project(projectId);
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')) as ExportManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new AppError(400, 'Manifest di export non riconosciuto');
  const present = (await readdir(source)).filter(name => name !== 'manifest.json').sort();
  if (JSON.stringify(present) !== JSON.stringify(manifest.files.map(file => file.name).sort())) throw new AppError(409, 'La cartella contiene file diversi da quelli del manifest');
  const content = new Map<string, string>();
  for (const file of manifest.files) {
    if (!/^[a-z.]+$/.test(file.name)) throw new AppError(400, 'Nome file non valido nel manifest');
    const text = await readFile(join(source, file.name), 'utf8');
    if (sha(text) !== file.sha256 || Buffer.byteLength(text) !== file.bytes) throw new AppError(409, `Checksum non valido: ${file.name}`);
    content.set(file.name, text);
  }
  const task = JSON.parse(content.get('task.json') ?? 'null') as { title: string; objective: string } | null;
  if (!task || typeof task.title !== 'string') throw new AppError(400, 'Export senza task');
  const { criteria } = JSON.parse(content.get('criteria.json') ?? '{"criteria":[]}') as { criteria: { content: string }[] };
  const decisions = JSON.parse(content.get('decisions.json') ?? '[]') as { content: string; state: string }[];
  const id = randomUUID();
  store.db.transaction(() => {
    store.db.prepare("INSERT INTO tasks(id,project_id,title,objective,status,created_at) VALUES(?,?,?,?,?,?)").run(id, projectId, `Importato: ${task.title}`.slice(0, 200), task.objective ?? '', 'ready', now());
    for (const criterion of criteria) {
      const cid = randomUUID();
      store.db.prepare('INSERT INTO criteria(id,task_id,content,created_at,updated_at) VALUES(?,?,?,?,?)').run(cid, id, criterion.content, now(), now());
      store.db.prepare('INSERT INTO criteria_history VALUES(?,?,?,?,?)').run(cid, 1, criterion.content, 'Importato da un export: la prova va rifatta', now());
    }
    for (const decision of decisions.filter(item => item.state === 'active'))
      store.db.prepare('INSERT INTO decisions(id,task_id,content,source,revision,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(), id, decision.content, 'imported', 1, now());
  })();
  store.event(id, null, 'imported', { fromExport: manifest.createdAt, criteria: criteria.length, decisions: decisions.length });
  return { taskId: id, criteria: criteria.length, decisions: decisions.filter(item => item.state === 'active').length };
}
