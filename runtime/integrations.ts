import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { executable, cleanEnvironment } from './process.js';
import { codexClient } from './adapters.js';
import { classifyTool } from './auth-status.js';

const execute = promisify(execFile);
export async function inventory() {
  return Promise.all(['codex', 'claude', 'cursor-agent', 'git', 'gh', 'ollama'].map(async name => {
    const path = executable(name);
    if (!path) return { id: name, installed: false, version: null, path: null, state: classifyTool(name, { installed: false, version: null }) };
    try { const { stdout } = await execute(path, ['--version'], { env: cleanEnvironment(), timeout: 10000 }); const version = stdout.trim().split('\n')[0] ?? null; return { id: name, installed: true, version, path, state: classifyTool(name, { installed: true, version }) }; }
    catch { return { id: name, installed: true, version: null, path, state: classifyTool(name, { installed: true, version: null }) }; }
  }));
}
export async function codexModels() {
  const client = await codexClient(tmpdir());
  try { const result = await client.request('model/list', { limit: 100 }); return result.data.filter((m: any) => !m.hidden).map((m: any) => ({ id: m.id, name: m.displayName, model: m.model, efforts: m.supportedReasoningEfforts.map((e: any) => e.reasoningEffort) })); }
  finally { await client.stop(); }
}
export async function localModels() {
  const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Server Ollama non disponibile');
  const result = await response.json() as { models: { name: string; digest: string; size: number }[] };
  return result.models.map(model => ({ id: model.name, name: model.name, digest: model.digest, bytes: model.size }));
}

export type CatalogModel = { id: string; name: string; efforts: string[]; source: 'listed' | 'declared' };
/** Parse `cursor-agent models` output: "id - Display name" lines after a heading. Anything else is ignored. */
export function parseCursorModels(output: string): CatalogModel[] {
  return output.split('\n').flatMap(line => {
    const match = /^([A-Za-z0-9][\w.\-[\]=,]*) - (.+?)(?: \((?:current|default)[^)]*\))?\s*$/.exec(line.trim());
    return match ? [{ id: match[1]!, name: match[2]!, efforts: [], source: 'listed' as const }] : [];
  });
}
export async function cursorModels(): Promise<CatalogModel[]> {
  const path = executable('cursor-agent');
  if (!path) throw new Error('Cursor CLI non trovato');
  const { stdout } = await execute(path, ['models'], { env: cleanEnvironment(), timeout: 30000 });
  return parseCursorModels(stdout);
}
/**
 * Claude Code has no model list command. These aliases and effort levels are declared from its own --help and are
 * labelled as declared, so the UI never presents them as a catalog read from the account.
 */
export function claudeModels(): CatalogModel[] {
  const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
  return ['fable', 'opus', 'sonnet', 'haiku'].map(id => ({ id, name: id, efforts, source: 'declared' as const }));
}
