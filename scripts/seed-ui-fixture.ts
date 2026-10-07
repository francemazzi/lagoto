import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { git } from '../runtime/git.js';
import { RunBudgets } from '../runtime/budget.js';
import { claudeNormalizer, normalizeAcpUpdate, normalizeCodexMessage, acpPermissionChoices, type AdapterEvent } from '../runtime/adapters.js';

// Builds a synthetic archive for the native UI tests: projects, real Git repositories with prepared worktrees,
// profiles in every state, transcripts replayed from real protocol fixtures, a queue and budgets.
// It imports data into a fresh archive; it never adds a fake adapter or an automation endpoint to the app.
// Usage: tsx scripts/seed-ui-fixture.ts <directory> [--load]
const root = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: seed-ui-fixture <directory> [--load]');
const load = process.argv.includes('--load');
rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true });
const store = new Store(join(root, 'data')); const service = new Service(store);
const call = (method: string, params: Record<string, unknown> = {}) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function repository(name: string, files: Record<string, string | Buffer>) {
  const path = join(root, 'repos', name); mkdirSync(path, { recursive: true });
  await git(path, ['init', '-b', 'main']); await git(path, ['config', 'user.name', 'Fixture']); await git(path, ['config', 'user.email', 'fixture@example.invalid']);
  for (const [file, content] of Object.entries(files)) { mkdirSync(join(path, file, '..'), { recursive: true }); writeFileSync(join(path, file), content); }
  await git(path, ['add', '.']); await git(path, ['commit', '-m', 'Fixture']);
  return path;
}
const frames = (name: string) => JSON.parse(readFileSync(`fixtures/protocols/${name}`, 'utf8')).frames as any[];
let clock = Date.now() - 3 * 3600 * 1000;
const tick = () => { clock += 1000; return new Date(clock).toISOString(); };
function startRun(taskId: string, profileId: string, text: string, state = 'finished') {
  const id = crypto.randomUUID();
  store.db.prepare('INSERT INTO runs(id,task_id,profile_id,state,model,created_at,ended_at) VALUES(?,?,?,?,?,?,?)').run(id, taskId, profileId, state, 'fixture', tick(), state === 'finished' ? tick() : null);
  store.event(taskId, id, 'user', { text, mode: 'agent' });
  return id;
}
const emit = (taskId: string, runId: string, events: AdapterEvent[]) => { for (const event of events) store.event(taskId, runId, event.kind, event); };

const verified = (modes: string[], efforts: string[]) => ({ modes, efforts, verification: 'passed', proof: { model: 'fixture', endpoint: null, identity: { runtime: 'fixture', version: '1' } } });
async function profile(name: string, provider: string, capabilities: object, enabled = 1) {
  const created = await call('profile/create', { name, provider, model: 'fixture', ...(provider === 'ollama' ? { endpoint: 'http://127.0.0.1:11434/v1' } : {}) });
  store.db.prepare('UPDATE profiles SET capabilities=?,enabled=? WHERE id=?').run(JSON.stringify(capabilities), enabled, created.id);
  return created;
}
function pool(profileId: string, residual: number, reset: Date, spentFraction = 0) {
  const id = crypto.randomUUID(), cycle = crypto.randomUUID(), reserve = Math.ceil(residual / 10);
  store.db.prepare('INSERT INTO budget_pools(id,name,unit,residual,reserve,reset_at,cycle,timezone) VALUES(?,?,?,?,?,?,?,?)').run(id, `Pool ${id.slice(0, 4)}`, 'tokens', residual, reserve, reset.toISOString(), cycle, 'UTC');
  store.db.prepare('INSERT INTO budget_cycles VALUES(?,?,?,?,?,?)').run(cycle, id, residual, reserve, reset.toISOString(), new Date(Date.now() - 86400000).toISOString());
  store.db.prepare('INSERT INTO profile_pools(profile_id,pool_id,reservation) VALUES(?,?,?)').run(profileId, id, 1000);
  if (spentFraction) { const a = new RunBudgets(store).status(profileId).allowance!; store.db.prepare('UPDATE allowances SET spent=? WHERE id=?').run(Math.floor(a.assigned * spentFraction), a.id); }
}

const backend = await repository('backend', { 'README.md': '# Backend\n\nContratto **API** versione 1.\n\n| Campo | Tipo |\n|---|---|\n| id | string |\n', 'src/app.ts': 'export const version = 1;\n', 'page.html': '<script>fetch("file:///etc/passwd")</script><h1>Ciao</h1>\n', 'logo.png': png, 'data.bin': Buffer.from([0, 1, 2, 3, 0, 255]), 'contract.json': '{"version":1}\n' });
const frontend = await repository('frontend', { 'src/client.ts': 'export const v = 1;\n', 'contract.json': '{"version":1}\n' });
const project = await call('project/create', { name: 'Progetto demo' });
await call('project/create', { name: 'Altro progetto' });
const repoBackend = await call('repository/add', { projectId: project.id, path: backend });
const repoFrontend = await call('repository/add', { projectId: project.id, path: frontend });

// Profiles in every state the UI must tell apart.
const codex = await profile('Codex · gpt-6.1-sol', 'codex', verified(['agent', 'plan'], ['low', 'high']));
const claude = await profile('Claude · sonnet', 'claude', verified(['agent'], []));
const cursor = await profile('Cursor · composer', 'cursor', verified(['agent'], []));
const local = await profile('Ollama · qwen3.5', 'ollama', verified(['agent'], []));
await profile('Kimi · da verificare', 'kimi', { modes: [], efforts: [], verification: 'unverified' });
await profile('Claude · accesso scaduto', 'claude', { modes: [], efforts: [], verification: 'failed', proof: { message: 'Failed to authenticate: OAuth session expired' } });
const lost = await profile('Codex · sessione interrotta', 'codex', verified(['agent'], []));
const renew = await profile('Qwen · budget scaduto', 'qwen', verified(['agent'], []));
const limited = await profile('Codex · riserva', 'codex', verified(['agent'], []));
pool(codex.id, 30_000_000, new Date(Date.now() + 10 * 86400000), 0.4);       // 60% today
pool(cursor.id, 30_000_000, new Date(Date.now() + 10 * 86400000), 0.8);      // 20% today
pool(renew.id, 30_000_000, new Date(Date.now() - 86400000));                  // expired cycle
pool(limited.id, 30_000_000, new Date(Date.now() + 10 * 86400000));
void claude; void local;

const task = await call('task/create', { projectId: project.id, title: 'Contratto API', objective: 'Allineare il contratto tra backend e frontend' });
await call('task/prepare', { taskId: task.id, repositoryIds: [repoBackend.id, repoFrontend.id] });
const work = (store.db.prepare('SELECT path FROM task_repositories WHERE task_id=? AND repository_id=?').get(task.id, repoBackend.id) as { path: string }).path;
const workFrontend = (store.db.prepare('SELECT path FROM task_repositories WHERE task_id=? AND repository_id=?').get(task.id, repoFrontend.id) as { path: string }).path;
writeFileSync(join(work, 'contract.json'), '{"version":2}\n');                    // unstaged
writeFileSync(join(work, 'src/app.ts'), 'export const version = 2;\n'); await git(work, ['add', 'src/app.ts']);   // staged
writeFileSync(join(work, 'notes.md'), '# Note\n\nNuovo file non tracciato.\n');   // untracked
writeFileSync(join(workFrontend, 'src/client.ts'), 'export const v = 2;\n');

// Run 1: a real Codex transcript (text, plan-like commentary, terminal command, usage).
const run1 = startRun(task.id, codex.id, 'Aggiorna il contratto e crea notes.txt');
emit(task.id, run1, frames('codex-0.160.1.json').flatMap(frame => normalizeCodexMessage(frame)));
emit(task.id, run1, [{ kind: 'plan', payload: { entries: [{ text: 'Aggiornare il contratto', status: 'completed' }, { text: 'Allineare il client', status: 'in_progress' }, { text: 'Eseguire i test', status: 'pending' }] } }]);
store.event(task.id, run1, 'run_state', { state: 'finished' }); store.event(task.id, null, 'checkpoint', { id: crypto.randomUUID(), excluded: [] });
// Run 2: a real Cursor transcript (file change with its diff, terminal command, permission with the backend's own choices).
const run2 = startRun(task.id, cursor.id, 'Controlla il risultato');
const cursorFrames = frames('cursor-2026.10.01.json');
for (const frame of cursorFrames) {
  if (frame.method === 'session/update') emit(task.id, run2, normalizeAcpUpdate(frame.params.update));
  if (frame.method === 'session/request_permission') {
    const id = crypto.randomUUID();
    store.event(task.id, run2, 'permission', { id, tool: frame.params.toolCall?.title ?? 'Cursor tool', input: frame.params.toolCall, choices: acpPermissionChoices(frame.params.options), timeoutSeconds: 50 });
    store.event(task.id, run2, 'permission_result', { id, allow: true, optionId: 'allow-once' });
  }
}
store.event(task.id, run2, 'run_state', { state: 'finished' });
// Run 3: a real Claude Code failure (expired OAuth session) with its cause.
const run3 = startRun(task.id, claude.id, 'Riprova', 'failed');
const normalize = claudeNormalizer();
emit(task.id, run3, frames('claude-2.1.283-auth-expired.json').flatMap(frame => normalize(frame)));
store.event(task.id, run3, 'run_state', { state: 'failed', cause: 'auth', action: 'Rinnova l’accesso in Integrazioni.', message: 'Failed to authenticate: OAuth session expired' });
await call('criterion/edit', { taskId: task.id, content: 'Il contratto compila su tutti i client', reason: 'Requisito iniziale' });
await call('decision/save', { taskId: task.id, content: 'Il contratto usa identificativi stringa' });
await call('task/queue', { taskId: task.id, id: crypto.randomUUID(), text: 'Poi aggiorna anche la documentazione' });
await call('task/queue', { taskId: task.id, id: crypto.randomUUID(), text: 'E aggiungi un test di regressione' });
await call('verification/start', { taskId: task.id, repositoryId: repoBackend.id, command: 'test -f contract.json' });
await new Promise(resolve => setTimeout(resolve, 600));
// A run that was alive when the app died: the runtime must not present it as running after a restart.
const interrupted = await call('task/create', { projectId: project.id, title: 'Lavoro interrotto', objective: 'Era in corso quando il Mac si è spento' });
const lostRun = startRun(interrupted.id, lost.id, 'Continua il lavoro lungo', 'running');
// The durable identity the supervisor recorded for the process; its group no longer exists, so reconciling can prove the stop.
store.db.prepare('INSERT INTO process_leases(id,owner_kind,owner_id,leader,started,members,state,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), 'run', lostRun, 99999999, 'Thu Jan  1 00:00:00 1970', '[]', 'running', new Date().toISOString());
// A second project for the folder and GitHub flows: a folder without Git, a repository with two GitHub remotes, a folder that was moved.
const folders = await call('project/create', { name: 'Progetto cartelle' });
const plain = join(root, 'repos', 'senza-git'); mkdirSync(plain, { recursive: true });
writeFileSync(join(plain, 'README.md'), '# Senza Git\n'); writeFileSync(join(plain, 'notes.txt'), 'Appunti sintetici\n'); writeFileSync(join(plain, '.env'), 'DB_PASSWORD=hunter2-sintetico\n');
await call('repository/add', { projectId: folders.id, path: plain });
const prepare = join(root, 'repos', 'da-preparare'); mkdirSync(prepare, { recursive: true });
writeFileSync(join(prepare, 'README.md'), '# Da preparare\n'); writeFileSync(join(prepare, '.env'), 'DB_PASSWORD=hunter2-sintetico\n');
await call('repository/add', { projectId: folders.id, path: prepare });
const multi = await repository('piu-remote', { 'README.md': '# Piu remote\n' });
await git(multi, ['remote', 'add', 'origin', 'git@github.com:acme/piu-remote.git']); await git(multi, ['remote', 'add', 'upstream', 'https://github.com/altro/piu-remote.git']);
await call('repository/add', { projectId: folders.id, path: multi });
const moved = await repository('spostata', { 'README.md': '# Spostata\n' });
await call('repository/add', { projectId: folders.id, path: moved });
renameSync(moved, `${moved}-altrove`);

const empty = await call('task/create', { projectId: project.id, title: 'Lavoro vuoto', objective: 'Ancora da iniziare' });

if (load) {
  const started = Date.now();
  let events = 0;
  const projects: string[] = [];
  for (let p = 0; p < 48; p++) projects.push((await call('project/create', { name: `Progetto carico ${String(p).padStart(2, '0')}` })).id);
  const tasks: string[] = [];
  for (let t = 0; t < 1000; t++) tasks.push((await call('task/create', { projectId: projects[t % projects.length]!, title: `Lavoro ${t}`, objective: 'Carico sintetico' })).id);
  store.db.transaction(() => {
    for (const [index, taskId] of tasks.entries()) {
      const run = crypto.randomUUID();
      store.db.prepare('INSERT INTO runs(id,task_id,profile_id,state,model,created_at,ended_at) VALUES(?,?,?,?,?,?,?)').run(run, taskId, codex.id, 'finished', 'fixture', tick(), tick());
      for (let e = 0; e < 100; e++) { store.event(taskId, run, e === 0 ? 'user' : 'text', e === 0 ? { text: `Richiesta ${index}` } : { kind: 'text', text: `Risposta ${e} `.repeat(8), itemId: `i${e}`, payload: {} }); events++; }
    }
  })();
  console.log(JSON.stringify({ loaded: { projects: projects.length + 2, tasks: tasks.length + 2, events }, seconds: Math.round((Date.now() - started) / 1000) }));
}

store.close();
console.log(JSON.stringify({ data: join(root, 'data'), project: 'Progetto demo', task: 'Contratto API', emptyTask: 'Lavoro vuoto', repositories: [backend, frontend], taskId: task.id, emptyTaskId: empty.id, load }));
