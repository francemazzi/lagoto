import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { qwenNormalizer } from '../runtime/qwen-normalizer.js';
import { transcript } from '../runtime/transcript.js';

const stores: Store[] = [];
afterEach(() => { for (const store of stores.splice(0)) { store.close(); rmSync(store.directory, { recursive: true, force: true }); } });
async function projection() {
  const store = new Store(mkdtempSync(join(tmpdir(), 'lagoto-qwen-replay-'))); stores.push(store);
  const service = new Service(store);
  const call = (method: string, params: Record<string, unknown>) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
  const project = await call('project/create', { name: 'Synthetic protocol replay' });
  const task = await call('task/create', { projectId: project.id, title: 'Offline fixture' });
  const profile = await call('profile/create', { name: 'Replay only', provider: 'ollama', model: 'qwen3.5:4b' });
  const run = crypto.randomUUID();
  store.db.prepare('INSERT INTO runs(id,task_id,profile_id,state,model,created_at) VALUES(?,?,?,?,?,?)').run(run, task.id, profile.id, 'finished', profile.model, new Date().toISOString());
  const normalize = qwenNormalizer();
  return { store, task, write: (source: any) => { for (const event of normalize(source)) store.event(task.id, run, event.kind, event); } };
}

it('P05-I02/P06-I04 replays actual offline Qwen events without duplicate final text, tools, reasoning or usage', async () => {
  const fixture = JSON.parse(readFileSync('fixtures/protocols/qwen-ollama-0.1.17.json', 'utf8'));
  const { store, task, write } = await projection();
  // SDK snapshots change IDs and reuse index 0. Identified repeated deliveries must
  // not double text or accounting; raw redacted deliveries remain inspectable.
  for (const event of fixture.events) { write(event); write(event); }
  const view = transcript(store.db, task.id).blocks as any[];
  expect(view.filter(b => b.kind === 'text').map(b => b.text)).toEqual(['LAGOTO_OK']);
  const reasoning = fixture.events.filter((e: any) => e.type === 'assistant').flatMap((e: any) => e.message.content)
    .filter((b: any) => b.type === 'thinking').map((b: any) => b.thinking);
  expect(view.filter(b => b.kind === 'reasoning').map(b => b.text)).toEqual(reasoning);
  expect(view.filter(b => b.kind === 'tool')).toHaveLength(4);
  expect(view.filter(b => b.kind === 'tool').every(b => b.detail.type === 'tool_result' && b.detail.content)).toBe(true);
  const counts = store.db.prepare('SELECT kind,count(*) AS count FROM events GROUP BY kind').all() as {kind: string; count: number}[];
  expect(counts.find(c => c.kind === 'raw')?.count).toBe(fixture.events.length * 2);
  expect(counts.find(c => c.kind === 'usage')?.count).toBe(1);
});

it('P05-I02 preserves identical answers in distinct SDK blocks and handles snapshots without streaming', async () => {
  const { store, task, write } = await projection();
  write({ type: 'stream_event', event: { type: 'message_start', message: { id: 'one-turn' } } });
  for (let i = 0; i < 2; i++) {
    write({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } });
    write({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { text: 'Identica 🐕' } } });
    write({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
    write({ type: 'assistant', message: { id: `snapshot-${i}`, content: [{ type: 'text', text: 'Identica 🐕' }] } });
  }
  write({ type: 'stream_event', event: { type: 'message_start', message: { id: 'next-turn' } } });
  write({ type: 'assistant', message: { id: 'no-stream', content: [{ type: 'text', text: 'Solo snapshot' }] } });
  write({ type: 'result', result: 'Solo snapshot', is_error: false });
  expect((transcript(store.db, task.id).blocks as any[]).filter(b => b.kind === 'text').map(b => b.text)).toEqual(['Identica 🐕', 'Identica 🐕', 'Solo snapshot']);
});
