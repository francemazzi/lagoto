import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startAdapter, type Profile, type AdapterEvent } from '../runtime/adapters.js';
import { redact } from '../runtime/protocol.js';
import { runtimeIdentity } from '../runtime/runtime-identity.js';
import { provenance, writeSmoke } from './evidence.js';
import { consumeRealRun, isRealRun } from './real-runs.js';

// Records the raw protocol of one real run (plan, file change, command, permission) as a replay fixture.
// Usage: pnpm capture:protocol <provider> <model> [endpoint]   (one real run, counted against the daily cap)
const provider = process.argv[2] as Profile['provider'];
const model = process.argv[3];
if (!provider || !model) throw new Error('Usage: pnpm capture:protocol <provider> <model> [endpoint]');
if (!process.argv[1]?.endsWith('.js')) throw new Error('Use pnpm capture:protocol so the isolated worker is compiled too');
if (isRealRun(provider)) consumeRealRun(`capture-protocol:${provider}:${model}`);
const context = provenance();
const folder = await mkdtemp(join(tmpdir(), 'lagoto-capture-'));
const cwd = join(folder, 'work'); await mkdir(cwd);
await writeFile(join(cwd, 'fixture.txt'), 'Synthetic capture fixture, no personal data.\n');
let secret: string | undefined;
if (provider === 'openrouter') secret = execFileSync('security', ['find-generic-password', '-a', 'lagoto-probe', '-s', 'org.frasma.lagoto.openrouter.test', '-w'], { encoding: 'utf8' }).trim();
const profile: Profile = { id: crypto.randomUUID(), provider, model, name: 'capture', endpoint: process.argv[4] ?? null, executable: null, capabilities: '{}' };
const identity = await runtimeIdentity(profile).catch(() => null);
const events: AdapterEvent[] = []; const permissions: { tool: string; input: unknown; choices: unknown; allowed: boolean }[] = [];
let status = 'failed'; let failure: string | null = null;
const started = Date.now();
let adapter: Awaited<ReturnType<typeof startAdapter>> | undefined;
try {
  adapter = await startAdapter({ profile, cwd, directories: [cwd], home: join(folder, 'home'), mode: 'agent', secret,
    prompt: 'This is a synthetic protocol capture in an empty directory. Do exactly this, briefly: (1) write a numbered plan of 3 short steps; (2) create notes.txt containing the single word CAPTURE; (3) run the shell command `ls` and report its output. Do nothing else.',
    onEvent: event => events.push(event),
    permission: async (tool, input, choices) => { permissions.push({ tool, input: redact(input), choices, allowed: true }); return true; } });
  await Promise.race([adapter.completion, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('capture timed out')), 240000))]);
  status = 'passed';
} catch (error) { failure = error instanceof Error ? error.message : String(error); }
finally { try { await adapter?.stop(); } catch { /* the capture is already recorded */ } }
const fixture = { provider, model, identity, capturedAt: new Date().toISOString(), cwdPlaceholder: cwd, events: redact(events), permissions };
const name = `${provider}-${String(identity && (identity as any).version ? (identity as any).version : 'unknown').replace(/[^\w.-]+/g, '_')}`;
if (status === 'passed') writeSmoke(`protocol-${name}`, { ...context, status, durationMs: Date.now() - started, summary: { events: events.length, kinds: Object.fromEntries([...new Set(events.map(e => e.kind))].map(kind => [kind, events.filter(e => e.kind === kind).length])), permissions: permissions.length } });
const target = writeSmoke(`capture-${name}`, { ...context, status, failure, fixture }, 'build/evidence/captures');
console.log(JSON.stringify({ status, failure, events: events.length, kinds: [...new Set(events.map(e => e.kind))], permissions: permissions.map(p => p.tool), capture: target }, null, 2));
process.exit(status === 'passed' ? 0 : 1);
