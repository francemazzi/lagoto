import { readdir, realpath, lstat, open } from 'node:fs/promises';
import { isAbsolute, join, relative, extname, normalize } from 'node:path';
import { AppError } from './protocol.js';

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_ENTRIES = 2000;
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
const LANGUAGES: Record<string, string> = { '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.json': 'json', '.md': 'markdown', '.markdown': 'markdown', '.html': 'html', '.htm': 'html', '.css': 'css',
  '.swift': 'swift', '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java', '.rb': 'ruby', '.sh': 'shell', '.zsh': 'shell', '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml', '.sql': 'sql', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.diff': 'diff', '.patch': 'diff', '.svg': 'xml', '.xml': 'xml', '.txt': 'text' };

/** Resolve a relative path inside a worktree. Absolute paths, `..`, `.git` and links leaving the root are refused. */
export async function resolveInside(root: string, input: string | undefined) {
  const path = input ?? '';
  if (path.includes('\0') || isAbsolute(path)) throw new AppError(403, 'Percorso non autorizzato');
  const cleaned = normalize(path || '.');
  const segments = cleaned.split('/').filter(segment => segment && segment !== '.');
  if (segments.includes('..') || segments.includes('.git')) throw new AppError(403, 'Percorso non autorizzato');
  const realRoot = await realpath(root);
  let canonical: string;
  try { canonical = await realpath(join(realRoot, ...segments)); } catch (error: any) { if (error.code === 'ENOENT') throw new AppError(404, 'File non trovato'); throw error; }
  const delta = relative(realRoot, canonical);
  if (delta.startsWith('..') || isAbsolute(delta) || delta.split('/').includes('.git')) throw new AppError(403, 'Il percorso esce dal worktree del task');
  return { realRoot, canonical, relative: segments.join('/') };
}

export type Entry = { name: string; kind: 'file' | 'dir' | 'symlink' | 'other'; bytes: number | null };
export async function listDirectory(root: string, input?: string) {
  const { canonical, relative: rel } = await resolveInside(root, input);
  if (!(await lstat(canonical)).isDirectory()) throw new AppError(400, 'Non è una cartella');
  const names = (await readdir(canonical, { withFileTypes: true })).filter(entry => entry.name !== '.git');
  const entries: Entry[] = [];
  for (const entry of names.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
    if (entries.length >= MAX_ENTRIES) break;
    const info = await lstat(join(canonical, entry.name));
    entries.push({ name: entry.name, kind: info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other', bytes: info.isFile() ? info.size : null });
  }
  return { path: rel, entries, truncated: names.length > entries.length };
}

export type FileContent = { path: string; bytes: number; kind: 'text' | 'image' | 'binary'; language: string | null; mime: string | null; text: string | null; base64: string | null; truncated: boolean };
/** Read a regular file under a size cap. Images travel as base64; text is returned as text only, never as markup to execute. */
export async function readWorkspaceFile(root: string, input: string, maxBytes = MAX_FILE_BYTES): Promise<FileContent> {
  if (!input) throw new AppError(400, 'Percorso del file richiesto');
  const limit = Math.min(Math.max(1, maxBytes), MAX_FILE_BYTES);
  const { canonical, relative: rel } = await resolveInside(root, input);
  const handle = await open(canonical, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new AppError(400, 'Non è un file regolare');
    const extension = extname(rel).toLowerCase();
    const mime = IMAGE_TYPES[extension] ?? null;
    if (mime) {
      if (info.size > limit) throw new AppError(413, 'Immagine troppo grande per l’anteprima');
      const buffer = Buffer.alloc(info.size); await handle.read(buffer, 0, info.size, 0);
      return { path: rel, bytes: info.size, kind: 'image', language: null, mime, text: null, base64: buffer.toString('base64'), truncated: false };
    }
    const length = Math.min(info.size, limit);
    const buffer = Buffer.alloc(length); await handle.read(buffer, 0, length, 0);
    if (buffer.subarray(0, 8000).includes(0)) return { path: rel, bytes: info.size, kind: 'binary', language: null, mime: null, text: null, base64: null, truncated: false };
    return { path: rel, bytes: info.size, kind: 'text', language: LANGUAGES[extension] ?? null, mime: null, text: buffer.toString('utf8'), base64: null, truncated: info.size > limit };
  } finally { await handle.close(); }
}

/** Unified diff of one file against HEAD (staged and unstaged together). Untracked files are shown as additions. */
export async function fileDiff(root: string, input: string, run: (args: string[]) => Promise<string>) {
  const { relative: rel, canonical } = await resolveInside(root, input);
  const tracked = (await run(['ls-files', '--error-unmatch', '-z', '--', rel]).catch(() => '')).length > 0;
  const limit = 1024 * 1024;
  if (tracked) {
    const diff = await run(['diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--', rel]);
    return { path: rel, tracked: true, binary: /^Binary files /m.test(diff), diff: diff.slice(0, limit), truncated: diff.length > limit };
  }
  const file = await readWorkspaceFile(root, rel, MAX_FILE_BYTES);
  if (file.kind !== 'text') return { path: rel, tracked: false, binary: true, diff: '', truncated: false };
  const lines = (file.text ?? '').split('\n'); if (lines.at(-1) === '') lines.pop();
  void canonical;
  return { path: rel, tracked: false, binary: false, diff: [`--- /dev/null`, `+++ b/${rel}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map(line => `+${line}`)].join('\n'), truncated: file.truncated };
}
