import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, redact } from './protocol.js';
import { JsonProcess, executable, cleanEnvironment, type ProcessMessage } from './process.js';
import { ScopedFiles } from './scoped-files.js';
import { cursorSandbox } from './sandbox.js';
import { qwenNormalizer } from './qwen-normalizer.js';

export type Profile = { id: string; provider: 'codex' | 'claude' | 'cursor' | 'qwen' | 'kimi' | 'ollama' | 'openrouter'; model: string; name: string; endpoint: string | null; executable: string | null; capabilities: string };
export type ToolCategory = 'terminal' | 'file_change' | 'plan';
export type AdapterEvent = { kind: 'text' | 'text_snapshot' | 'reasoning' | 'reasoning_snapshot' | 'tool' | 'result' | 'usage' | 'system' | 'error' | 'raw' | 'child' | 'plan'; text?: string; payload: unknown; itemId?: string; category?: ToolCategory };
export type PermissionChoice = { id: string; label: string; kind: 'allow' | 'reject' };
export type PermissionDecision = boolean | { allow: boolean; optionId?: string };
/** Choices are the options the backend really offers; a boolean answer keeps meaning allow once or reject once. */
export type Permission = (tool: string, input: unknown, choices?: PermissionChoice[]) => Promise<PermissionDecision>;
const allowed = (decision: PermissionDecision) => typeof decision === 'boolean' ? decision : decision.allow;
const picked = (decision: PermissionDecision) => typeof decision === 'object' ? decision.optionId : undefined;
export type RunOptions = { profile: Profile; cwd: string; directories: string[]; prompt: string; mode: 'plan' | 'agent'; effort?: string; secret?: string; home: string; onEvent: (event: AdapterEvent) => void; permission: Permission; onProcess?:(client:JsonProcess)=>void;
  /** Internal test harness can constrain the SDK worker with an OS policy; never exposed over IPC. */
  workerLauncher?:(command:string,args:string[],cwd:string,environment:Record<string,string>)=>JsonProcess };
export interface RunningAdapter { sessionId: string | null; completion: Promise<void>; stop(): Promise<void> }

export async function codexClient(cwd: string, configured?: string | null,onProcess?:(client:JsonProcess)=>void) {
  const path = executable('codex', configured); if (!path) throw new AppError(404, 'Codex CLI non trovato');
  const client = new JsonProcess(path, ['app-server'], cwd);
  try {
    onProcess?.(client);
    await client.request('initialize', { clientInfo: { name: 'lagoto', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    client.send({ jsonrpc: '2.0', method: 'initialized', params: {} }); return client;
  } catch (error) { await client.stop(); throw error; }
}

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
export function claudeToolCategory(name: unknown): ToolCategory | undefined {
  if (typeof name !== 'string') return undefined;
  if (name === 'Bash' || name === 'BashOutput') return 'terminal';
  if (FILE_TOOLS.has(name)) return 'file_change';
  if (name === 'TodoWrite') return 'plan';
  return undefined;
}
export function normalizeClaude(message: ProcessMessage, currentMessage='message', children: Set<string> = new Set()): AdapterEvent[] {
  const raw: AdapterEvent = { kind: 'raw', payload: message };
  if (message.type === 'stream_event') {
    const event = message.event;
    if (event?.type === 'content_block_delta' && typeof event.delta?.text === 'string') return [raw, { kind: 'text', text: event.delta.text, itemId: `${currentMessage}:${event.index ?? 0}`, payload: {} }];
    if (event?.type === 'content_block_delta' && typeof event.delta?.thinking === 'string') return [raw, { kind: 'reasoning', text: event.delta.thinking, payload: {} }];
  }
  if (message.type === 'assistant') return [raw, ...((message.message?.content ?? []) as ProcessMessage[]).flatMap((block,index):AdapterEvent[] =>
    block.type==='tool_use'?[{kind:'tool',payload:block,...(claudeToolCategory(block.name)?{category:claudeToolCategory(block.name)!}:{})},...(block.name==='TodoWrite'&&Array.isArray(block.input?.todos)?[{kind:'plan' as const,payload:{entries:block.input.todos.map((todo:any)=>({text:String(todo.content??todo.activeForm??''),status:String(todo.status??'pending')}))}}]:[]),...(block.name==='Task'&&typeof block.id==='string'?(children.add(block.id),[{kind:'child' as const,payload:{childId:block.id,state:'started',title:typeof block.input?.description==='string'?block.input.description.slice(0,200):null,source:'claude:Task'}}]):[])]:block.type==='text'?[{kind:'text_snapshot',text:block.text,itemId:`${message.message?.id ?? currentMessage}:${index}`,payload:{}}]:[])];
  if (message.type === 'user') return [raw, ...((Array.isArray(message.message?.content) ? message.message.content : []) as ProcessMessage[]).filter(block => block.type === 'tool_result').flatMap((block): AdapterEvent[] => [{ kind: 'tool' as const, payload: block },
    ...(children.has(block.tool_use_id) ? [{ kind: 'child' as const, payload: { childId: block.tool_use_id, state: block.is_error ? 'failed' : 'completed', result: (typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '')).slice(0, 4000), source: 'claude:Task' } }] : [])])];
  if (message.type === 'result') return [raw, { kind: message.is_error ? 'error' : 'result', text: message.result, payload: message }, { kind: 'usage', payload: { usage: message.usage, cost: message.total_cost_usd, scope: 'session', source: 'runtime-estimate' } }];
  return [raw];
}

export function claudeNormalizer() {
  let messageId='message';let sequence=0;const children=new Set<string>();
  return (message:ProcessMessage)=>{
    if(message.type==='stream_event' && message.event?.type==='message_start')messageId=message.event.message?.id ?? `message-${++sequence}`;
    return normalizeClaude(message,messageId,children);
  };
}

/** Category of a Codex thread item, from the item types observed in codex-cli 0.160.1 (commandExecution). */
export function codexItemCategory(item: any): ToolCategory | undefined {
  switch (item?.type) { case 'commandExecution': return 'terminal'; case 'fileChange': return 'file_change'; case 'plan': case 'todoList': return 'plan'; default: return undefined; }
}
/** Pure translation of one Codex app-server notification into journal events (raw frames are recorded by the caller). */
export function normalizeCodexMessage(message: ProcessMessage): AdapterEvent[] {
  const p = message.params ?? {};
  switch (message.method) {
    case 'item/agentMessage/delta': return [{ kind: 'text', text: p.delta, itemId: p.itemId, payload: {} }];
    case 'item/reasoning/summaryTextDelta': return [{ kind: 'reasoning', text: p.delta, itemId: p.itemId, payload: {} }];
    case 'error': return [{ kind: 'error', text: p.error?.message, payload: p }];
    case 'thread/tokenUsage/updated': return [{ kind: 'usage', payload: p }];
    case 'turn/completed': return [{ kind: p.turn?.status === 'completed' ? 'result' : 'error', payload: p }];
    case 'item/completed': if (p.item?.type === 'agentMessage') return [{ kind: 'text_snapshot', text: p.item.text, itemId: p.item.id, payload: {} }];
    // falls through: other completed items are tools
    case 'item/started': {
      if (['agentMessage', 'reasoning', 'userMessage'].includes(p.item?.type)) return [];
      const category = codexItemCategory(p.item);
      const events: AdapterEvent[] = [{ kind: 'tool', payload: p.item, ...(category ? { category } : {}) }];
      if (category === 'plan') events.push({ kind: 'plan', payload: { entries: [{ text: String(p.item?.text ?? p.item?.summary ?? ''), status: 'pending' }] } });
      return events;
    }
    default: return [];
  }
}

async function startCodex(options: RunOptions): Promise<RunningAdapter> {
  const client = await codexClient(options.cwd, options.profile.executable,options.onProcess);
  let turnId: string | null = null;
  let resolve!: () => void; let reject!: (error: Error) => void; let finished = false;
  const completion = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void completion.catch(() => {}); // A process can fail while the start handshake is still pending.
  client.onClose = () => { if (!finished) reject(new AppError(502, 'Codex terminato senza esito del turno')); };
  client.onMessage = message => {
    options.onEvent({ kind: 'raw', payload: message });
    if (message.method?.endsWith('/requestApproval') && message.id != null) {
      const choices: PermissionChoice[] = [{ id: 'accept', label: 'Consenti una volta', kind: 'allow' }, { id: 'decline', label: 'Rifiuta', kind: 'reject' }];
      void options.permission(message.method, message.params, choices).then(decision => { const wanted = picked(decision); client.send({ jsonrpc: '2.0', id: message.id, result: { decision: wanted && choices.some(choice => choice.id === wanted) ? wanted : allowed(decision) ? 'accept' : 'decline' } }); }).catch(error => reject(error)); return;
    }
    if (message.id != null && message.method) {
      client.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Client capability not available' } }); return;
    }
    const p = message.params ?? {};
    for (const event of normalizeCodexMessage(message)) options.onEvent(event);
    if (message.method === 'turn/completed') {
      finished = true;
      if (p.turn?.status !== 'completed') reject(new AppError(p.turn?.status === 'interrupted' ? 499 : 502, p.turn.error?.message ?? 'Turno Codex non completato')); else resolve();
    }
  };
  try {
    const thread = await client.request('thread/start', { model: options.profile.model, cwd: options.cwd, approvalPolicy: 'on-request', sandbox: options.mode === 'plan' ? 'read-only' : 'workspace-write',
      config: { 'features.multi_agent': false }, developerInstructions: 'Work only in the explicitly authorized project directories. Ask before external side effects.' });
    const response = await client.request('turn/start', { threadId: thread.thread.id, input: [{ type: 'text', text: options.prompt, text_elements: [] }],
      ...(options.effort ? { effort: options.effort } : {}),
      sandboxPolicy: options.mode === 'plan' ? { type: 'readOnly' } : { type: 'workspaceWrite', writableRoots: options.directories, networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true } });
    turnId = response.turn.id;
    return { sessionId: thread.thread.id, completion,
      stop: async () => { if (!finished && turnId) { try { await client.request('turn/interrupt', { threadId: thread.thread.id, turnId }); } catch {} } await client.stop(); } };
  } catch (error) { finished = true; await client.stop(); throw error; }
}

async function startClaude(options: RunOptions): Promise<RunningAdapter> {
  const path = executable('claude', options.profile.executable); if (!path) throw new AppError(404, 'Claude Code non trovato');
  const args = ['--safe-mode', '--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', options.profile.model,
    '--permission-mode', options.mode === 'plan' ? 'plan' : 'manual', '--permission-prompts', 'host', '--permission-prompt-tool', 'stdio'];
  for (const directory of options.directories.slice(1)) args.push('--add-dir', directory);
  if (options.effort) args.push('--effort', options.effort);
  const client = new JsonProcess(path, args, options.cwd);
  try{options.onProcess?.(client);}catch(error){await client.stop();throw error;}
  const normalize = claudeNormalizer();
  let finished = false; let sessionId: string | null = null;
  let resolve!: () => void; let reject!: (error: Error) => void;
  const completion = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void completion.catch(() => {});
  client.onClose = code => { if (!finished) reject(new AppError(502, `Claude terminato senza risultato (${code})`)); };
  client.onMessage = message => {
    if (message.session_id) sessionId = message.session_id;
    if (message.type === 'control_request') {
      options.onEvent({kind:'raw',payload:message});
      if (message.request?.subtype === 'can_use_tool') {
        void options.permission(message.request.tool_name, message.request.input, [{ id: 'allow', label: 'Consenti una volta', kind: 'allow' }, { id: 'deny', label: 'Rifiuta', kind: 'reject' }]).then(decision => client.send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id,
          response: allowed(decision) ? { behavior: 'allow', updatedInput: message.request.input } : { behavior: 'deny', message: 'Operazione rifiutata' } } })).catch(error => reject(error));
      } else client.send({ type: 'control_response', response: { subtype: 'error', request_id: message.request_id, error: 'Unsupported control request' } });
      return;
    }
    for (const event of normalize(message)) options.onEvent(event);
    if (message.type === 'result') { finished = true; if (message.is_error) reject(new AppError(502, `Turno Claude fallito: ${String(redact(typeof message.result === 'string' ? message.result : 'senza dettagli')).slice(0, 400)}`)); else resolve(); }
  };
  client.send({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'initialize', hooks: {} } });
  client.send({ type: 'user', session_id: '', message: { role: 'user', content: options.prompt }, parent_tool_use_id: null });
  return { get sessionId() { return sessionId; }, completion, stop: () => client.stop() };
}

async function startQwen(options: RunOptions): Promise<RunningAdapter> {
  if (!options.profile.endpoint) throw new AppError(400, 'Endpoint richiesto');
  const endpoint = new URL(options.profile.endpoint);
  if (options.profile.provider !== 'ollama' && !options.secret) throw new AppError(401, 'Chiave API richiesta per questo endpoint');
  if (options.profile.provider !== 'ollama' && endpoint.protocol !== 'https:') throw new AppError(400, 'Endpoint cloud deve usare HTTPS');
  if (options.profile.provider === 'ollama' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new AppError(400, 'Il profilo locale richiede un server loopback');
  await mkdir(options.home, { recursive: true, mode: 0o700 });
  const launch=options.workerLauncher??((command,args,cwd,environment)=>new JsonProcess(command,args,cwd,environment));
  const client = launch(process.execPath, [fileURLToPath(new URL('./qwen-worker.js', import.meta.url))], options.cwd,
    cleanEnvironment({ HOME: options.home, OPENAI_API_KEY: options.secret ?? 'ollama', OPENAI_BASE_URL: options.profile.endpoint, OPENAI_MODEL: options.profile.model }));
  try{options.onProcess?.(client);}catch(error){await client.stop();throw error;}
  let done = false; let sessionId: string | null = null;
  const normalize = qwenNormalizer();
  let resolve!: () => void; let reject!: (error: Error) => void;
  const completion = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void completion.catch(() => {});
  client.onClose = () => { if (!done) reject(new AppError(502, 'Qwen SDK terminato senza esito')); };
  client.onMessage = message => {
    if (message.method === 'permission') {
      void options.permission(message.params.tool, message.params.input, [{ id: 'allow', label: 'Consenti una volta', kind: 'allow' }, { id: 'deny', label: 'Rifiuta', kind: 'reject' }]).then(decision => client.send({ jsonrpc: '2.0', id: message.id, result: { allow: allowed(decision) } })).catch(error => reject(error)); return;
    }
    if (message.method === 'event') {
      const native = message.params;
      if (native.session_id) sessionId = native.session_id;
      for (const event of normalize(native)) options.onEvent(event);
    } else if (message.method === 'complete') { done = true; resolve(); }
    else if (message.method === 'failure') { done = true; reject(new AppError(502, message.params.message)); }
  };
  client.send({ method: 'start', params: { prompt: options.prompt, model: options.profile.model, cwd: options.cwd, directories: options.directories, mode: options.mode } });
  return { get sessionId() { return sessionId; }, completion, stop: () => client.stop() };
}

/** The choices an ACP backend really offered for a permission request, with their own labels. */
export function acpPermissionChoices(options: any): PermissionChoice[] {
  return (Array.isArray(options) ? options : []).map((option: any) => ({ id: String(option.optionId), label: String(option.name ?? option.optionId), kind: String(option.kind ?? option.optionId ?? '').startsWith('allow') ? 'allow' as const : 'reject' as const }));
}
const ACP_CATEGORIES: Record<string, ToolCategory> = { execute: 'terminal', edit: 'file_change', delete: 'file_change', move: 'file_change' };
/** Pure translation of one ACP `session/update` into journal events. Unknown variants are kept as system data, never dropped. */
export function normalizeAcpUpdate(update: any): AdapterEvent[] {
  const kind = update?.sessionUpdate;
  if (kind === 'agent_message_chunk' && update.content?.type === 'text') return [{ kind: 'text', text: update.content.text, payload: {} }];
  if (kind === 'agent_thought_chunk' && update.content?.type === 'text') return [{ kind: 'reasoning', text: update.content.text, payload: {} }];
  if (kind === 'plan' && Array.isArray(update.entries)) return [{ kind: 'plan', payload: { entries: update.entries.map((entry: any) => ({ text: String(entry.content ?? ''), status: String(entry.status ?? 'pending') })) } }];
  if (kind === 'tool_call' || kind === 'tool_call_update') {
    const category = ACP_CATEGORIES[String(update.kind)];
    return [{ kind: 'tool', payload: update, ...(category ? { category } : {}) }];
  }
  return [{ kind: 'system', payload: update }];
}

async function startCursor(options: RunOptions): Promise<RunningAdapter> {
  const path = executable('cursor-agent', options.profile.executable); if (!path) throw new AppError(404, 'Cursor CLI non trovato');
  await mkdir(options.home, { recursive: true, mode: 0o700 });
  try { await writeFile(join(options.home, 'cli-config.json'), JSON.stringify({ version: 1, 'editor.vimMode': false,
    permissions: { allow: [], deny: ['Write(../**)', 'Read(../**)', 'Write(**/.git/**)'] } }), { flag: 'wx', mode: 0o600 }); }
  catch (error: any) { if (error.code !== 'EEXIST') throw error; }
  const args = ['--sandbox', 'enabled'];
  for (const directory of options.directories.slice(1)) args.push('--add-dir', directory);
  args.push('acp');
  const sandbox = await cursorSandbox(path, args, options.directories, options.home, options.mode === 'agent');
  const client = new JsonProcess(sandbox.command, sandbox.args, options.cwd,
    cleanEnvironment({ CURSOR_CONFIG_DIR: options.home, CURSOR_DATA_DIR: sandbox.temporary, TMPDIR: sandbox.temporary }));
  try{options.onProcess?.(client);}catch(error){await client.stop();throw error;}
  const files = new ScopedFiles(options.directories);
  let activeSession: string | undefined;
  client.onMessage = message => {
    options.onEvent({ kind: 'raw', payload: message });
    const p = message.params ?? {};
    if (['fs/read_text_file','fs/write_text_file'].includes(message.method)) {
      void (async () => {
        if (!activeSession || p.sessionId !== activeSession) throw new AppError(403, 'Sessione ACP non autorizzata');
        if (message.method === 'fs/read_text_file') return files.read(p.path, p.line, p.limit);
        if (options.mode !== 'agent' || !allowed(await options.permission(message.method, p, [{ id: 'allow', label: 'Consenti una volta', kind: 'allow' }, { id: 'reject', label: 'Rifiuta', kind: 'reject' }]))) throw new AppError(403, 'Scrittura rifiutata');
        return files.write(p.path, p.content);
      })().then(result => client.send({ jsonrpc: '2.0', id: message.id, result }), error => client.send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error.message } })).catch(() => {});
    } else if (message.method === 'session/request_permission') {
      const offered = acpPermissionChoices(p.options);
      void options.permission(p.toolCall?.title ?? 'Cursor tool', p.toolCall, offered).then(decision => {
        const allow = allowed(decision); const wanted = picked(decision);
        const choice = (wanted && p.options?.find((v: any) => v.optionId === wanted)) || p.options?.find((v: any) => v.kind === (allow ? 'allow_once' : 'reject_once'));
        client.send({ jsonrpc: '2.0', id: message.id, result: { outcome: choice ? { outcome: 'selected', optionId: choice.optionId } : { outcome: 'cancelled' } } });
      }).catch(() => { /* Late permission after process close has no effect. */ });
    } else if (message.id != null && message.method) client.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Client capability not available' } });
    else if (message.method === 'session/update') {
      for (const event of normalizeAcpUpdate(p.update)) options.onEvent(event);
    }
  };
  try {
    const negotiation = await client.request('initialize', { protocolVersion: 1, clientInfo: { name: 'lagoto', version: '0.1.0' }, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false } });
    options.onEvent({ kind: 'system', payload: { negotiation } });
    await client.request('authenticate', { methodId: 'cursor_login' });
    const session = await client.request('session/new', { cwd: options.cwd, mcpServers: [] });
    activeSession = session.sessionId;
    options.onEvent({ kind: 'system', payload: { session } });
    if (options.mode !== 'agent') {
      if (!session.modes?.availableModes?.some((mode: any) => mode.id === options.mode)) throw new AppError(400, 'Modalità Cursor non disponibile');
      await client.request('session/set_mode', { sessionId: session.sessionId, modeId: options.mode });
    }
    if (options.profile.model !== 'default') await client.request('session/set_model', { sessionId: session.sessionId, modelId: options.profile.model });
    const completion = client.request('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: options.prompt }] }, 300000).then(result => { options.onEvent({ kind: 'result', payload: result }); });
    let done = false; void completion.then(() => { done = true; }, () => { done = true; });
    return { sessionId: session.sessionId, completion, stop: async () => { if (!done) client.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: session.sessionId } }); await client.stop(); } };
  } catch (error) { await client.stop(); throw error; }
}
export function startAdapter(options: RunOptions): Promise<RunningAdapter> {
  switch (options.profile.provider) {
    case 'codex': return startCodex(options);
    case 'claude': return startClaude(options);
    case 'cursor': return startCursor(options);
    default: return startQwen(options);
  }
}
