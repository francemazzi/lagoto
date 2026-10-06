import { realpath, stat, readFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, dirname, basename, join } from 'node:path';
import { AppError } from './protocol.js';

/** Scope for ACP filesystem requests; this does not sandbox the provider's own tools. */
export class ScopedFiles {
  constructor(private roots: string[]) {}
  private async path(input: unknown, create = false) {
    if (typeof input !== 'string' || !isAbsolute(input) || input.split('/').includes('.git')) throw new AppError(403, 'Percorso non autorizzato');
    const parent = await realpath(dirname(input));
    let canonical = join(parent, basename(input));
    try { canonical = await realpath(input); } catch (error: any) { if (!create || error.code !== 'ENOENT') throw error; }
    for (const root of this.roots) {
      const delta = relative(await realpath(root), canonical);
      if (delta && delta !== '..' && !delta.startsWith('../') && !isAbsolute(delta) && !delta.split('/').includes('.git')) return canonical;
    }
    throw new AppError(403, 'File esterno alle directory autorizzate');
  }
  async read(input: unknown, line?: number, limit?: number) {
    const path = await this.path(input);
    if ((await stat(path)).size > 1024 * 1024) throw new AppError(413, 'File troppo grande per ACP');
    if ((line !== undefined && (!Number.isInteger(line) || line < 1)) || (limit !== undefined && (!Number.isInteger(limit) || limit < 1))) throw new AppError(400, 'Intervallo di righe non valido');
    const content = await readFile(path, 'utf8');
    if (line === undefined && limit === undefined) return { content };
    const start = (line ?? 1) - 1;
    return { content: content.split(/(?<=\n)/).slice(start, limit === undefined ? undefined : start + limit).join('') };
  }
  async write(input: unknown, content: unknown) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > 1024 * 1024) throw new AppError(413, 'Contenuto ACP non valido o troppo grande');
    const path = await this.path(input, true);
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try { await file.truncate(0); await file.writeFile(content); await file.sync(); } finally { await file.close(); }
    return {};
  }
}
