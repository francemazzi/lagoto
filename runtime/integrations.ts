import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { executable, cleanEnvironment } from './process.js';
import { codexClient } from './adapters.js';

const execute = promisify(execFile);
export async function inventory() {
  return Promise.all(['codex', 'claude', 'cursor-agent', 'git', 'gh', 'ollama'].map(async name => {
    const path = executable(name);
    if (!path) return { id: name, installed: false, version: null, path: null };
    try { const { stdout } = await execute(path, ['--version'], { env: cleanEnvironment(), timeout: 10000 }); return { id: name, installed: true, version: stdout.trim().split('\n')[0], path }; }
    catch { return { id: name, installed: true, version: null, path }; }
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
