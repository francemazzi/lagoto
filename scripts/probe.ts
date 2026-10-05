import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { executable, JsonProcess, cleanEnvironment } from '../runtime/process.js';

const fixture = await mkdtemp(join(tmpdir(), 'lagoto-probe-'));
const report: Record<string, unknown> = { date: new Date().toISOString(), platform: process.platform, arch: process.arch, node: process.version, scope: 'discovery only; no inference acceptance' };
for (const name of ['git', 'gh', 'codex', 'claude', 'cursor-agent', 'ollama']) {
  const path = executable(name);
  try { report[name] = { installed: Boolean(path), version: path ? execFileSync(path, ['--version'], { encoding: 'utf8', timeout: 10000, env: cleanEnvironment() }).trim().slice(0, 180) : null }; }
  catch { report[name] = { installed: Boolean(path), version: 'unavailable' }; }
}
const codexPath = executable('codex');
if (codexPath) {
  const client = new JsonProcess(codexPath, ['app-server'], fixture);
  try {
    await client.request('initialize', { clientInfo: { name: 'lagoto', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    client.send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    const account = await client.request('account/read', { refreshToken: false });
    const catalog = await client.request('model/list', { limit: 100 });
    report.codexProtocol = { handshake: true, authenticated: Boolean(account.account), models: catalog.data.map((m: any) => ({ id: m.id, model: m.model, name: m.displayName, default: m.isDefault, efforts: m.supportedReasoningEfforts })) };
  } catch (error) { report.codexProtocol = { handshake: false, error: error instanceof Error ? error.message : 'unknown' }; }
  finally { try { await client.stop(); } catch (error) { report.codexStop = { verified: false, reason: String(error) }; } }
}
const cursor = executable('cursor-agent');
if (cursor) {
  const client = new JsonProcess(cursor, ['acp'], fixture);
  try { report.cursorACP = { handshake: true, response: await client.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'lagoto', version: '0.1.0' } }, 10000) }; }
  catch (error) { report.cursorACP = { handshake: false, error: error instanceof Error ? error.message : 'unknown' }; }
  finally { try { await client.stop(); } catch (error) { report.cursorStop = { verified: false, reason: String(error) }; } }
}
await mkdir('build/evidence', { recursive: true });
await writeFile('build/evidence/discovery.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
