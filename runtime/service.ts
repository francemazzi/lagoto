import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from './storage.js';
import { Request, AppError, identifier, now, protocolVersion } from './protocol.js';
import { addRepository, prepareWorktrees, diffs } from './git.js';
import { RunManager } from './runs.js';
import { inventory, codexModels, localModels } from './integrations.js';
import { createCheckpoint, contextPack } from './checkpoint.js';
import { transcript } from './transcript.js';
import { ProfileVerifier } from './profiles.js';
import { Handoffs } from './handoff.js';
import { Verifications } from './verification.js';
import { RunBudgets } from './budget.js';
import { createBackup,restoreBackup } from './backup.js';
import { Deliveries,deliveryView } from './delivery.js';
import { TaskMemory } from './task-memory.js';

export class Service {
  readonly runs: RunManager;
  readonly profiles: ProfileVerifier;
  readonly handoffs: Handoffs;
  readonly verifications:Verifications;
  readonly deliveries:Deliveries;
  readonly memory:TaskMemory;
  constructor(readonly store: Store, notify: (event: unknown) => void = () => {}) {
    this.runs = new RunManager(store, notify); this.profiles = new ProfileVerifier(store,notify);
    this.verifications=new Verifications(store,notify);
    this.handoffs=new Handoffs(store,this.runs,this.verifications);
    this.deliveries=new Deliveries(store);
    this.memory=new TaskMemory(store,this.verifications);
  }
  async handle(request: Request): Promise<unknown> {
    const p = request.params;
    switch (request.method) {
      case 'initialize': {
        const input = z.object({ protocolVersion: z.literal(protocolVersion) }).strict().parse(p);
        return { protocolVersion: input.protocolVersion, version: '0.1.0', platform: process.platform, arch: process.arch, sqlite: this.store.db.prepare('SELECT sqlite_version() AS version').get() };
      }
      case 'backup/create': {const {destination}=z.object({destination:z.string().min(1)}).strict().parse(p);return createBackup(this.store,destination);}
      case 'backup/restore': {const {source,destination}=z.object({source:z.string().min(1),destination:z.string().min(1)}).strict().parse(p);return restoreBackup(source,destination);}
      case 'delivery/preview': {const i=z.object({taskId:identifier,id:identifier,message:z.string().trim().min(1).max(2000),selections:z.array(z.object({repositoryId:identifier,paths:z.array(z.string().min(1)).min(1),remote:z.string().min(1).optional()}).strict()).min(1)}).strict().parse(p);return deliveryView(await this.deliveries.preview(i.taskId,i.id,i.message,i.selections));}
      case 'delivery/confirm': {const i=z.object({id:identifier,hash:z.string().length(64)}).strict().parse(p);return deliveryView(await this.deliveries.confirm(i.id,i.hash));}
      case 'delivery/list': {const {taskId}=z.object({taskId:identifier}).strict().parse(p);this.store.task(taskId);return (this.store.db.prepare("SELECT payload FROM external_actions WHERE task_id=? AND kind='delivery' ORDER BY created_at DESC").all(taskId) as {payload:string}[]).map(r=>deliveryView(JSON.parse(r.payload)));}
      case 'task/progress': {const {taskId}=z.object({taskId:identifier}).strict().parse(p);return this.memory.status(taskId);}
      case 'criterion/edit': {const i=z.object({taskId:identifier,content:z.string().trim().min(1).max(8000),reason:z.string().trim().min(1).max(2000),id:identifier.optional(),revision:z.number().int().positive().optional()}).strict().parse(p);return this.memory.edit(i.taskId,i.content,i.reason,i.id,i.revision);}
      case 'criterion/accept': {const i=z.object({taskId:identifier,id:identifier,revision:z.number().int().positive(),verificationId:identifier.optional(),overrideReason:z.string().trim().min(1).max(2000).optional()}).strict().parse(p);return this.memory.accept(i.taskId,i.id,i.revision,i.verificationId,i.overrideReason);}
      case 'decision/save': {const i=z.object({taskId:identifier,content:z.string().trim().min(1).max(8000),supersedes:identifier.optional()}).strict().parse(p);return this.memory.decision(i.taskId,i.content,i.supersedes);}
      case 'task/complete': {const {taskId}=z.object({taskId:identifier}).strict().parse(p);return this.memory.complete(taskId);}
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
      case 'task/snapshot': {
        const { taskId, before } = z.object({taskId:identifier,before:z.number().int().positive().optional()}).strict().parse(p);
        const task = this.store.task(taskId);
        return {task,...transcript(this.store.db,taskId,before),
          runs:this.store.db.prepare('SELECT r.*,p.name AS profile_name,p.provider FROM runs r JOIN profiles p ON p.id=r.profile_id WHERE task_id=? ORDER BY r.created_at').all(taskId),
          repositories:this.store.db.prepare('SELECT tr.*,r.name FROM task_repositories tr JOIN repositories r ON r.id=tr.repository_id WHERE task_id=?').all(taskId),
          queued:this.store.db.prepare("SELECT * FROM queued_messages WHERE task_id=? AND state='queued' ORDER BY created_at").all(taskId)};
      }
      case 'task/queue': {
        const {taskId,text,id} = z.object({taskId:identifier,text:z.string().trim().min(1).max(100000),id:identifier}).strict().parse(p);
        this.store.task(taskId);
        const old=this.store.db.prepare('SELECT * FROM queued_messages WHERE id=?').get(id) as {task_id:string;text:string}|undefined;
        if(old && (old.task_id!==taskId || old.text!==text))throw new AppError(409,'Richiesta riutilizzata con un altro messaggio');
        this.store.db.prepare('INSERT OR IGNORE INTO queued_messages(id,task_id,text,created_at) VALUES(?,?,?,?)').run(id,taskId,text,now());
        return {id,state:'queued'};
      }
      case 'task/queue/remove': {
        const {taskId,id}=z.object({taskId:identifier,id:identifier}).strict().parse(p);this.store.task(taskId);
        this.store.db.prepare("UPDATE queued_messages SET state='cancelled' WHERE id=? AND task_id=? AND state='queued'").run(id,taskId);return {removed:true};
      }
      case 'task/diff': {
        const { taskId } = z.object({ taskId: identifier }).strict().parse(p); return diffs(this.store, taskId);
      }
      case 'verification/start': {const i=z.object({taskId:identifier,repositoryId:identifier,command:z.string().trim().min(1).max(4000)}).strict().parse(p);return this.verifications.start(i.taskId,i.repositoryId,i.command);}
      case 'verification/list': {const {taskId}=z.object({taskId:identifier}).strict().parse(p);return this.verifications.list(taskId);}
      case 'verification/stop': {const {taskId}=z.object({taskId:identifier}).strict().parse(p);await this.verifications.stopTask(taskId);return{stopped:true};}
      case 'verification/reconcile': {const {id}=z.object({id:identifier}).strict().parse(p);return this.verifications.reconcile(id);}
      case 'integration/list': return inventory();
      case 'model/codex': return codexModels();
      case 'model/ollama': return localModels();
      case 'profile/list': return (this.store.db.prepare('SELECT * FROM profiles ORDER BY provider,name').all() as { capabilities: string }[]).map(row => ({ ...row, capabilities: JSON.parse(row.capabilities) }));
      case 'budget/pools': return this.store.db.prepare('SELECT * FROM budget_pools ORDER BY name').all();
      case 'budget/create': {
        const i=z.object({name:z.string().trim().min(1).max(120),residual:z.number().int().nonnegative().max(1e12),resetAt:z.iso.datetime()}).strict().parse(p);
        if(new Date(i.resetAt)<=new Date())throw new AppError(400,'La data di rinnovo deve essere futura');
        const id=randomUUID();this.store.db.prepare('INSERT INTO budget_pools(id,name,unit,residual,reserve,reset_at,cycle) VALUES(?,?,?,?,?,?,?)').run(id,i.name,'tokens',i.residual,Math.ceil(i.residual/10),i.resetAt,randomUUID());return{id};
      }
      case 'budget/link': {
        const i=z.object({profileId:identifier,poolId:identifier,reservation:z.number().int().positive().max(1e9)}).strict().parse(p);
        if(this.store.db.prepare("SELECT 1 FROM runs WHERE profile_id=? AND state IN ('starting','running','stopping','waiting_permission','unknown')").get(i.profileId))throw new AppError(409,'Budget non modificabile durante una run');
        const source=this.store.db.prepare('SELECT provider FROM profiles WHERE id=?').get(i.profileId) as {provider:string}|undefined;
        if(!source)throw new AppError(404,'Profilo non trovato');
        if(this.store.db.prepare('SELECT 1 FROM profiles p JOIN profile_pools pp ON pp.profile_id=p.id WHERE pp.pool_id=? AND p.provider<>?').get(i.poolId,source.provider))throw new AppError(400,'Metriche di runtime diversi richiedono pool distinti');
        this.store.db.prepare('INSERT INTO profile_pools VALUES(?,?,?) ON CONFLICT(profile_id) DO UPDATE SET pool_id=excluded.pool_id,reservation=excluded.reservation').run(i.profileId,i.poolId,i.reservation);return{linked:true};
      }
      case 'budget/status': {const {profileId}=z.object({profileId:identifier}).strict().parse(p);return new RunBudgets(this.store).status(profileId);}
      case 'profile/verify': {
        const {profileId,secret}=z.object({profileId:identifier,secret:z.string().optional()}).strict().parse(p);return this.profiles.start(profileId,secret);
      }
      case 'profile/cancel': {const {profileId}=z.object({profileId:identifier}).strict().parse(p);return this.profiles.cancel(profileId);}
      case 'profile/checks': {
        const {profileId}=z.object({profileId:identifier}).strict().parse(p);
        return (this.store.db.prepare('SELECT * FROM profile_checks WHERE profile_id=? ORDER BY created_at DESC LIMIT 10').all(profileId) as {detail:string}[]).map(row=>({...row,detail:JSON.parse(row.detail)}));
      }
      case 'profile/create': {
        const input = z.object({ name: z.string().trim().min(1).max(120), provider: z.enum(['codex', 'claude', 'cursor', 'qwen', 'kimi', 'ollama', 'openrouter']), model: z.string().min(1).max(200), endpoint: z.string().url().optional(), executable: z.string().optional() }).strict().parse(p);
        const id = randomUUID();
        // Model existence and individual capabilities still require a probe. A manual name is not certification.
        this.store.db.prepare('INSERT INTO profiles(id,name,provider,model,endpoint,executable,capabilities) VALUES(?,?,?,?,?,?,?)')
          .run(id, input.name, input.provider, input.model, input.endpoint ?? null, input.executable ?? null, JSON.stringify({ modes: [], efforts: [], verification: 'unverified' }));
        return { id, ...input };
      }
      case 'run/start': {
        const input = z.object({ taskId: identifier, profileId: identifier, prompt: z.string().trim().min(1).max(100000), requestId: identifier, mode: z.enum(['plan','agent']), secret: z.string().optional(), effort: z.string().optional(), queueId:identifier.optional() }).strict().parse(p);
        return this.runs.start(input.taskId, input.profileId, input.prompt, input.requestId, input.mode, input.secret, input.effort,undefined,undefined,input.queueId);
      }
      case 'handoff/prepare': {const {taskId,profileId,id}=z.object({taskId:identifier,profileId:identifier,id:identifier}).strict().parse(p);return this.handoffs.prepare(taskId,profileId,id);}
      case 'handoff/confirm': {const i=z.object({id:identifier,hash:z.string().length(64),prompt:z.string().trim().min(1).max(100000),mode:z.enum(['agent','plan']),secret:z.string().optional(),effort:z.string().optional(),queueId:identifier.optional()}).strict().parse(p);return this.handoffs.confirm(i.id,i.hash,i.prompt,i.mode,i.secret,i.effort,i.queueId);}
      case 'handoff/cancel': {const {id}=z.object({id:identifier}).strict().parse(p);return this.handoffs.cancel(id);}
      case 'handoff/list': {const {taskId}=z.object({taskId:identifier}).strict().parse(p);this.store.task(taskId);return this.store.db.prepare('SELECT * FROM handoffs WHERE task_id=? ORDER BY created_at DESC').all(taskId);}
      case 'run/stop': { const { runId } = z.object({ runId: identifier }).strict().parse(p); return this.runs.stop(runId); }
      case 'run/reconcile': {const {runId}=z.object({runId:identifier}).strict().parse(p);return this.runs.reconcile(runId);}
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
