import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startAdapter, type Profile, type AdapterEvent } from '../runtime/adapters.js';
import { redact } from '../runtime/protocol.js';
import { provenance, writeSmoke } from './evidence.js';
import { consumeRealRun, isRealRun } from './real-runs.js';

const provider = process.argv[2] as Profile['provider'];
const model = process.argv[3];
if (!provider || !model) throw new Error('Usage: smoke-provider <provider> <model> [endpoint]');
if (!process.argv[1]?.endsWith('.js')) throw new Error('Use pnpm smoke:provider so the isolated worker is compiled too');
const evidenceContext = provenance();
const fixture = await mkdtemp(join(tmpdir(), 'lagoto-live-'));
const roots: string[] = [];
for (const name of ['backend', 'frontend', 'desktop']) {
  const path = join(fixture, name); await mkdir(path); await writeFile(join(path, 'fixture.txt'), `Synthetic ${name}: LAGOTO_${name.toUpperCase()}_V1\n`); roots.push(path);
}
const events: AdapterEvent[] = [];
const approvals: unknown[] = [];
let secret: string | undefined;
if (provider === 'openrouter') secret = execFileSync('security', ['find-generic-password', '-a', 'lagoto-probe', '-s', 'org.frasma.lagoto.openrouter.test', '-w'], { encoding: 'utf8' }).trim();
const profile: Profile = { id: crypto.randomUUID(), provider, model, name: `${provider} smoke`, endpoint: process.argv[4] ?? null, executable: null, capabilities: '{}' };
const started = Date.now();
let status = 'failed'; let failure: string | null = null; let sessionId: string | null = null;
let runtime: Awaited<ReturnType<typeof startAdapter>> | undefined;
if (isRealRun(provider)) consumeRealRun(`smoke-provider:${provider}:${model}`);
try {
  runtime = await startAdapter({ profile, cwd: roots[0]!, directories: roots, home: join(fixture, 'isolated-home'), mode: 'agent', secret,
    prompt: `This is a bounded integration test in synthetic directories. Read fixture.txt in each of these three directories: ${roots.join(', ')}. Create ONLY result.txt in the first directory, containing exactly the three fixture markers separated by newlines (LAGOTO_BACKEND_V1, LAGOTO_FRONTEND_V1, LAGOTO_DESKTOP_V1). Do not run shell commands, access the network, or spawn subagents. Finally reply LAGOTO_OK.`,
    onEvent: event => events.push(event),
    permission: async (tool, input) => {
      const text = JSON.stringify(input);
      const allowed = /edit|write|fileChange/i.test(tool) && text.includes('result.txt') && !text.includes('..') && !/command|bash|shell/i.test(tool);
      approvals.push({ tool, allowed }); return allowed;
    },
  });
  let timer: NodeJS.Timeout | undefined;
  try { await Promise.race([runtime.completion, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Probe timeout after 120 seconds')), 120000); })]); }
  finally { clearTimeout(timer); }
  sessionId = runtime.sessionId;
  const text = (await readFile(join(roots[0]!, 'result.txt'), 'utf8')).trim();
  if (text !== 'LAGOTO_BACKEND_V1\nLAGOTO_FRONTEND_V1\nLAGOTO_DESKTOP_V1') throw new Error('Independent filesystem assertion failed');
  if (!events.some(e => e.kind === 'result')) throw new Error('No final result event');
  status = 'passed';
} catch (error) { failure = String(redact(error instanceof Error ? error.message : String(error))); }
finally { if (runtime) try { await runtime.stop(); } catch (error) { status = 'failed'; failure = String(error); } }
const report = { ...evidenceContext, completedAt: new Date().toISOString(), status, provider, model, endpoint: profile.endpoint, durationMs: Date.now() - started, sessionObserved: Boolean(sessionId), approvals, failure,
  counts: Object.fromEntries(['text', 'tool', 'result', 'usage', 'raw'].map(kind => [kind, events.filter(e => e.kind === kind).length])),
  // Only synthetic fixtures are used; redact even these before writing evidence.
  events: redact(events), assertion: 'read three roots and verify exact written bytes; not a full capability gate' };
await mkdir('build/evidence', { recursive: true });
await mkdir('build/evidence/history', { recursive: true });
writeSmoke(`history/smoke-${provider}-${model.replaceAll('/', '_').replaceAll(':', '_')}-${evidenceContext.date.replaceAll(':','-')}`, report);
writeSmoke(`smoke-${provider}-${model.replaceAll('/', '_').replaceAll(':', '_')}`, report);
console.log(JSON.stringify({ ...report, events: undefined }, null, 2));
process.exitCode = status === 'passed' ? 0 : 1;
