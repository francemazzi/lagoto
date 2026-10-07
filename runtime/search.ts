import type { Store } from './storage.js';

export type SearchHit = { kind: 'task' | 'message' | 'decision' | 'criterion' | 'checkpoint'; taskId: string; taskTitle: string; ref: string; snippet: string };

const escapeLike = (text: string) => text.replace(/[\\%_]/g, match => `\\${match}`);
function snippet(text: string, query: string) {
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, index - 60);
  return (start > 0 ? '…' : '') + text.slice(start, start + 200).replace(/\s+/g, ' ') + (text.length > start + 200 ? '…' : '');
}

/**
 * Offline search over everything the archive already holds: tasks, messages, decisions, criteria and checkpoints.
 * It uses only the local database, so it works with the network down and never contacts GitHub or a provider.
 */
export function searchArchive(store: Store, query: string, options: { projectId?: string; limit?: number } = {}) {
  const needle = query.trim();
  if (needle.length < 2) return { hits: [] as SearchHit[], limited: false, query: needle };
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const like = `%${escapeLike(needle)}%`;
  const scope = options.projectId ? ' AND t.project_id=?' : '';
  const args = (...values: unknown[]) => options.projectId ? [...values, options.projectId] : values;
  const hits: SearchHit[] = [];
  const add = (rows: { task_id: string; title: string; ref: string; text: string }[], kind: SearchHit['kind']) => { for (const row of rows) hits.push({ kind, taskId: row.task_id, taskTitle: row.title, ref: row.ref, snippet: snippet(row.text, needle) }); };
  add(store.db.prepare(`SELECT t.id AS task_id,t.title,t.id AS ref,t.title||' — '||t.objective AS text FROM tasks t WHERE (t.title LIKE ? ESCAPE '\\' OR t.objective LIKE ? ESCAPE '\\')${scope} ORDER BY t.created_at DESC LIMIT ${limit + 1}`).all(...args(like, like)) as any[], 'task');
  add(store.db.prepare(`SELECT x.task_id,t.title,x.id AS ref,x.text FROM transcript x JOIN tasks t ON t.id=x.task_id WHERE x.kind IN ('user','text') AND x.text LIKE ? ESCAPE '\\'${scope} ORDER BY x.last_seq DESC LIMIT ${limit + 1}`).all(...args(like)) as any[], 'message');
  add(store.db.prepare(`SELECT d.task_id,t.title,d.id AS ref,d.content AS text FROM decisions d JOIN tasks t ON t.id=d.task_id WHERE d.content LIKE ? ESCAPE '\\'${scope} ORDER BY d.created_at DESC LIMIT ${limit + 1}`).all(...args(like)) as any[], 'decision');
  add(store.db.prepare(`SELECT c.task_id,t.title,c.id AS ref,c.content AS text FROM criteria c JOIN tasks t ON t.id=c.task_id WHERE c.content LIKE ? ESCAPE '\\'${scope} ORDER BY c.created_at DESC LIMIT ${limit + 1}`).all(...args(like)) as any[], 'criterion');
  add(store.db.prepare(`SELECT k.task_id,t.title,k.id AS ref,k.created_at||' · '||k.id AS text FROM checkpoints k JOIN tasks t ON t.id=k.task_id WHERE (k.id LIKE ? ESCAPE '\\' OR k.created_at LIKE ? ESCAPE '\\')${scope} ORDER BY k.created_at DESC LIMIT ${limit + 1}`).all(...args(like, like)) as any[], 'checkpoint');
  return { hits: hits.slice(0, limit), limited: hits.length > limit, query: needle };
}
