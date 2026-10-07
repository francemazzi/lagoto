import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startAdapter } from '../runtime/adapters.js';
import { classifyFailure } from '../runtime/errors.js';

/** A worker double that records how it was launched; the adapter code under test is real. */
function recordingLauncher() {
  const launches: { environment: Record<string, string>; stops: number }[] = [];
  const launcher = (_command: string, _args: string[], _cwd: string, environment: Record<string, string>) => {
    const launch = { environment, stops: 0 }; launches.push(launch);
    const worker: any = { onMessage: () => {}, onClose: () => {}, send(message: any) { if (message.method === 'start') queueMicrotask(() => worker.onMessage({ method: 'complete', params: {} })); }, stop: async () => { launch.stops++; } };
    return worker;
  };
  return { launches, launcher };
}
const original = process.env.OPENAI_API_KEY;
afterEach(() => { if (original === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original; });
const start = async (provider: 'qwen' | 'kimi' | 'ollama', endpoint: string, secret: string | undefined, launcher: any) => {
  const home = mkdtempSync(join(tmpdir(), `lagoto-${provider}-`));
  const adapter = await startAdapter({ profile: { id: crypto.randomUUID(), provider, model: `${provider}-model`, name: provider, endpoint, executable: null, capabilities: '{}' },
    cwd: home, directories: [home], home: join(home, 'h'), mode: 'agent', prompt: 'x', secret, onEvent: () => {}, permission: async () => false, workerLauncher: launcher });
  await adapter.completion; return adapter;
};

describe('P06-I07 Qwen and Kimi cloud profiles', () => {
  it('P06-I07 each profile reaches its worker with its own key, endpoint and model and nothing from the host or the other profile', async () => {
    process.env.OPENAI_API_KEY = 'host-key-must-not-leak';
    const { launches, launcher } = recordingLauncher();
    await start('qwen', 'https://qwen.example/v1', 'qwen-secret-0001', launcher);
    await start('kimi', 'https://kimi.example/v1', 'kimi-secret-0002', launcher);
    const [qwen, kimi] = launches.map(item => item.environment);
    expect(qwen).toMatchObject({ OPENAI_API_KEY: 'qwen-secret-0001', OPENAI_BASE_URL: 'https://qwen.example/v1', OPENAI_MODEL: 'qwen-model' });
    expect(kimi).toMatchObject({ OPENAI_API_KEY: 'kimi-secret-0002', OPENAI_BASE_URL: 'https://kimi.example/v1', OPENAI_MODEL: 'kimi-model' });
    expect(qwen!.HOME).not.toBe(kimi!.HOME);
    for (const environment of [qwen!, kimi!]) expect(JSON.stringify(environment)).not.toContain('host-key-must-not-leak');
    expect(JSON.stringify(qwen)).not.toContain('kimi-secret'); expect(JSON.stringify(kimi)).not.toContain('qwen-secret');
  });
});

describe('P06-I08 Ollama', () => {
  it('P06-I08 server off, busy queue and a model that fails to load are three different causes with different actions', () => {
    const off = classifyFailure('connect ECONNREFUSED 127.0.0.1:11434'), busy = classifyFailure('server is busy, queue full (503)'), load = classifyFailure('llama runner process has terminated: error loading model: out of memory');
    expect([off.cause, busy.cause, load.cause]).toEqual(['server_unavailable', 'queue_busy', 'model_load']);
    expect(new Set([off.action, busy.action, load.action]).size).toBe(3);
  });
  it('P06-I08 stopping a run stops only its own worker and no runtime code terminates a server by name', async () => {
    const { launches, launcher } = recordingLauncher();
    const adapter = await start('ollama', 'http://127.0.0.1:11434/v1', undefined, launcher);
    await adapter.stop();
    expect(launches).toHaveLength(1); expect(launches[0]!.stops).toBe(1);
    const sources = readdirSync('runtime').filter(name => name.endsWith('.ts')).map(name => readFileSync(join('runtime', name), 'utf8'));
    expect(sources.some(text => /pkill|killall|ollama\s+stop|launchctl\s+(stop|unload)[^\n]*ollama/i.test(text))).toBe(false);
  });
});
