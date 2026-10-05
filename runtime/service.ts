import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from './storage.js';
import { Request, AppError, identifier, now, protocolVersion } from './protocol.js';
import { addRepository, prepareWorktrees, diffs } from './git.js';
import { RunManager } from './runs.js';
import { inventory, codexModels, localModels } from './integrations.js';
import { createCheckpoint, contextPack } from './checkpoint.js';

export class Service {
  readonly runs: RunManager;
  constructor(readonly store: Store, notify: (event: unknown) => void = () => {}) { this.runs = new RunManager(store, notify); }
  async handle(request: Request): Promise<unknown> {
    const p = request.params;
    switch (request.method) {
      case 'initialize': {
        const input = z.object({ protocolVersion: z.literal(protocolVersion) }).strict().parse(p);
        return { protocolVersion: input.protocolVersion, version: '0.1.0', platform: process.platform, arch: process.arch, sqlite: this.store.db.prepare('SELECT sqlite_version() AS version').get() };
      }
      case 'health': return { ready: true, protocolVersion, version: '0.1.0' };
      case 'project/list': return this.store.db.prepare('SELECT * FROM projects WHERE archived=0 ORDER BY created_at,id').all();
      case 'project/create': {
        const { name } = z.object({ name: z.string().trim().min(1).max(120) }).strict().parse(p);
        const id = randomUUID(); this.store.db.prepare('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)').run(id, name, now());
        return this.store.project(id);
      }
      case 'project/archive': {
        const { projectId } = z.object({ projectId: identifier }).strict().parse(p);
        this.store.project(projectId); this.store.db.prepare('UPDATE projects SET archived=1 WHERE id=?').run(projectId); return { archived: true };
      }
      case 'repository/list': {
        const { projectId } = z.object({ projectId: identifier }).strict().parse(p); this.store.project(projectId);
        return this.store.db.prepare('SELECT * FROM repositories WHERE project_id=? ORDER BY name').all(projectId);
      }
      case 'repository/add': {
        const { projectId, path } = z.object({ projectId: identifier, path: z.string().min(1) }).strict().parse(p);
        return addRepository(this.store, projectId, path);
      }
      case 'task/list': {
        const { projectId } = z.object({ projectId: identifier }).strict().parse(p); this.store.project(projectId);
        return this.store.db.prepare('SELECT * FROM tasks WHERE project_id=? ORDER BY created_at,id').all(projectId);
      }
      case 'task/create': {
        const { projectId, title, objective } = z.object({ projectId: identifier, title: z.string().trim().min(1).max(200), objective: z.string().max(100000).default('') }).strict().parse(p);
        this.store.project(projectId); const id = randomUUID();
        this.store.db.prepare('INSERT INTO tasks(id,project_id,title,objective,created_at) VALUES(?,?,?,?,?)').run(id, projectId, title, objective, now());
        return this.store.task(id);
      }
      case 'task/prepare': {
        const { taskId, repositoryIds } = z.object({ taskId: identifier, repositoryIds: z.array(identifier).min(1) }).strict().parse(p);
        return prepareWorktrees(this.store, taskId, repositoryIds);
      }
      case 'task/events': {
        const { taskId, after } = z.object({ taskId: identifier, after: z.number().int().min(0).default(0) }).strict().parse(p); this.store.task(taskId);
        return this.store.events(taskId, after);
      }
      case 'task/diff': {
        const { taskId } = z.object({ taskId: identifier }).strict().parse(p); return diffs(this.store, taskId);
      }
      case 'integration/list': return inventory();
      case 'model/codex': return codexModels();
      case 'model/ollama': return localModels();
      case 'profile/list': return (this.store.db.prepare('SELECT * FROM profiles ORDER BY provider,name').all() as { capabilities: string }[]).map(row => ({ ...row, capabilities: JSON.parse(row.capabilities) }));
      case 'profile/create': {
        const input = z.object({ name: z.string().trim().min(1).max(120), provider: z.enum(['codex', 'claude', 'cursor', 'qwen', 'kimi', 'ollama', 'openrouter']), model: z.string().min(1).max(200), endpoint: z.string().url().optional(), executable: z.string().optional() }).strict().parse(p);
        const id = randomUUID();
        // Model existence and individual capabilities still require a probe. A manual name is not certification.
        this.store.db.prepare('INSERT INTO profiles(id,name,provider,model,endpoint,executable,capabilities) VALUES(?,?,?,?,?,?,?)')
          .run(id, input.name, input.provider, input.model, input.endpoint ?? null, input.executable ?? null, JSON.stringify({ modes: [], efforts: [], verification: 'unverified' }));
        return { id, ...input };
      }
      case 'run/start': {
        const input = z.object({ taskId: identifier, profileId: identifier, prompt: z.string().trim().min(1).max(100000), requestId: identifier, mode: z.enum(['plan','agent']), secret: z.string().optional(), effort: z.string().optional() }).strict().parse(p);
        return this.runs.start(input.taskId, input.profileId, input.prompt, input.requestId, input.mode, input.secret, input.effort);
      }
      case 'run/stop': { const { runId } = z.object({ runId: identifier }).strict().parse(p); return this.runs.stop(runId); }
      case 'run/permission': {
        const { runId, permissionId, allow } = z.object({ runId: identifier, permissionId: identifier, allow: z.boolean() }).strict().parse(p);
        return this.runs.answer(runId, permissionId, allow);
      }
      case 'run/list': { const { taskId } = z.object({ taskId: identifier }).strict().parse(p); this.store.task(taskId); return this.store.db.prepare('SELECT * FROM runs WHERE task_id=? ORDER BY created_at').all(taskId); }
      case 'checkpoint/create': { const { taskId } = z.object({ taskId: identifier }).strict().parse(p); return createCheckpoint(this.store, taskId); }
      case 'checkpoint/list': { const { taskId } = z.object({ taskId: identifier }).strict().parse(p); this.store.task(taskId); return this.store.db.prepare('SELECT id,created_at FROM checkpoints WHERE task_id=? ORDER BY created_at DESC').all(taskId); }
      case 'context/preview': { const { taskId, maximumCharacters } = z.object({ taskId: identifier, maximumCharacters: z.number().int().min(1000).max(1000000).default(24000) }).strict().parse(p); return contextPack(this.store, taskId, maximumCharacters); }
      default: throw new AppError(-32601, 'Metodo non supportato');
    }
  }
}
