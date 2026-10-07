import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { acpPermissionChoices, claudeNormalizer, normalizeAcpUpdate, normalizeCodexMessage, type AdapterEvent } from '../runtime/adapters.js';
import { classifyFailure } from '../runtime/errors.js';
import { transcript } from '../runtime/transcript.js';
import { runOccupancy } from '../runtime/context-meter.js';

const stores: Store[] = [];
afterEach(() => { for (const s of stores.splice(0)) { try { s.close(); } catch { /* closed */ } rmSync(s.directory, { recursive: true, force: true }); } });
const load = (name: string) => JSON.parse(readFileSync(`fixtures/protocols/${name}`, 'utf8')) as { provider: string; identity: { version: string }; permissions: { tool: string; choices: any[] }[]; frames: any[] };

async function journal(events: AdapterEvent[]) {
  const store = new Store(mkdtempSync(join(tmpdir(), 'lagoto-replay-'))); stores.push(store); const service = new Service(store);
  const call = (method: string, params: Record<string, unknown> = {}) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
  const project = await call('project/create', { name: 'Replay' }); const task = await call('task/create', { projectId: project.id, title: 'Replay' });
  const profile = await call('profile/create', { name: 'R', provider: 'codex', model: 'm' });
  const run = crypto.randomUUID();
  store.db.prepare('INSERT INTO runs(id,task_id,profile_id,state,model,created_at) VALUES(?,?,?,?,?,?)').run(run, task.id, profile.id, 'finished', 'm', new Date().toISOString());
  for (const event of events) store.event(task.id, run, event.kind, event);
  return { store, task, run, blocks: transcript(store.db, task.id).blocks as any[] };
}

describe('P02-I08 replay of real Codex protocol frames', () => {
  it('P02-I08 P06-I02 turns codex-cli 0.160.1 frames into a text answer, a categorized terminal tool with its output, usage and a result', async () => {
    const fixture = load('codex-0.160.1.json');
    const events = fixture.frames.flatMap(frame => normalizeCodexMessage(frame));
    expect(events.map(event => event.kind)).toEqual(expect.arrayContaining(['text', 'tool', 'usage', 'result']));
    const { blocks, store, run } = await journal(events);
    const terminal = blocks.filter(block => block.kind === 'tool' && block.detail.category === 'terminal');
    expect(terminal).toHaveLength(1);
    expect(terminal[0].detail).toMatchObject({ type: 'commandExecution', status: 'completed', exitCode: 0, aggregatedOutput: 'fixture.txt\nnotes.txt\n' });
    expect(terminal[0].detail.command).toContain('printf CAPTURE > notes.txt');
    expect(blocks.filter(block => block.kind === 'text').map(block => block.text).join('\n')).toContain('notes.txt');
    expect(runOccupancy(store.db, run)).toMatchObject({ source: 'measured', window: 258400 });
    expect(blocks.some(block => block.kind === 'tool' && block.detail.type === 'userMessage')).toBe(false);
  });
});

describe('P02-I08 replay of real Cursor ACP frames', () => {
  it('P02-I08 P10-I01 turns cursor-agent 2026.10.01 updates into a file-change tool with its diff, a terminal tool and the real permission choices', async () => {
    const fixture = load('cursor-2026.10.01.json');
    const events = fixture.frames.filter(frame => frame.method === 'session/update').flatMap(frame => normalizeAcpUpdate(frame.params.update));
    const { blocks } = await journal(events);
    const edit = blocks.find(block => block.kind === 'tool' && block.detail.category === 'file_change');
    expect(edit).toBeTruthy();
    expect(JSON.stringify(edit.detail.content)).toContain('CAPTURE');
    expect(edit.detail.status).toBe('completed');
    expect(blocks.find(block => block.kind === 'tool' && block.detail.category === 'terminal')?.detail.rawInput).toEqual({ command: 'ls' });
    expect(blocks.filter(block => block.kind === 'tool')).toHaveLength(2);
    const permission = fixture.frames.find(frame => frame.method === 'session/request_permission');
    expect(permission).toBeTruthy();
    const choices = acpPermissionChoices(permission.params.options);
    expect(choices.map(choice => choice.kind)).toEqual(['allow', 'allow', 'reject']);
    expect(choices.map(choice => choice.id)).toEqual(expect.arrayContaining(['allow-once', 'allow-always', 'reject-once']));
    expect(fixture.permissions[0]!.choices).toEqual(choices);
  });
  it('P02-I08 keeps an unknown update variant as system data instead of dropping or guessing it', () => {
    expect(normalizeAcpUpdate({ sessionUpdate: 'brand_new_update', x: 1 })).toEqual([{ kind: 'system', payload: { sessionUpdate: 'brand_new_update', x: 1 } }]);
    expect(normalizeAcpUpdate({ sessionUpdate: 'plan', entries: [{ content: 'Passo uno', status: 'pending' }] })).toEqual([{ kind: 'plan', payload: { entries: [{ text: 'Passo uno', status: 'pending' }] } }]);
  });
});

describe('P02-I08 replay of real Claude Code stream-json frames', () => {
  it('P02-I08 P06-I01 turns the Read and Write tool frames into tool blocks, with Write marked as a file change', async () => {
    const fixture = load('claude-2.1.283-tools.json');
    const normalize = claudeNormalizer();
    const events = fixture.frames.flatMap(frame => normalize(frame));
    const { blocks } = await journal(events);
    const tools = blocks.filter(block => block.kind === 'tool');
    expect(tools.map(block => block.detail.name).filter(Boolean)).toEqual(expect.arrayContaining(['Read', 'Write']));
    expect(tools.find(block => block.detail.name === 'Write')?.detail.category).toBe('file_change');
    expect(tools.find(block => block.detail.name === 'Read')?.detail.category).toBeUndefined();
    expect(blocks.filter(block => block.kind === 'text').length).toBeGreaterThan(0);
  });
  it('P02-I08 P06-I06 an expired OAuth session is reported with its real message and classified as an access problem', async () => {
    const fixture = load('claude-2.1.283-auth-expired.json');
    const normalize = claudeNormalizer();
    const events = fixture.frames.flatMap(frame => normalize(frame));
    const error = events.find(event => event.kind === 'error');
    expect(error?.text).toContain('OAuth session expired');
    expect(classifyFailure(error!.text!).cause).toBe('auth');
  });
});
