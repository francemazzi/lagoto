import { randomUUID } from 'node:crypto';
import { Store } from './storage.js';
import { fingerprint } from './checkpoint.js';
import { JsonProcess,cleanEnvironment } from './process.js';
import { AppError,now,redact } from './protocol.js';
import {ProcessLeases} from './process-leases.js';

export class Verifications {
  private active=new Map<string,{taskId:string;client:JsonProcess;done:Promise<void>;interrupt:()=>void}>();
  constructor(private store:Store,private notify:(event:unknown)=>void){}
  async start(taskId:string,repositoryId:string,command:string){
    this.store.task(taskId);
    if(this.store.db.prepare("SELECT 1 FROM runs WHERE task_id=? AND state IN ('starting','running','stopping','waiting_permission','unknown')").get(taskId) || this.store.db.prepare("SELECT 1 FROM verifications WHERE task_id=? AND state IN ('running','unknown')").get(taskId))throw new AppError(409,'Un writer o una verifica possiede già il lavoro');
    const repo=this.store.db.prepare('SELECT path FROM task_repositories WHERE task_id=? AND repository_id=?').get(taskId,repositoryId) as {path:string}|undefined;
    if(!repo)throw new AppError(403,'Repository esterno al task');
    const before=await fingerprint(repo.path);const id=randomUUID();
    this.store.db.prepare('INSERT INTO verifications VALUES(?,?,?,?,?,?,?)').run(id,taskId,JSON.stringify({repositoryId,command}),before,'running','',now());
    const client=new JsonProcess('/bin/zsh',['-c',command],repo.path,cleanEnvironment(),'text');let output=Buffer.alloc(0);let interrupted=false,overflow=false;
    try{new ProcessLeases(this.store).track('verification',id,client);}catch(error){await client.stop();this.store.db.prepare("UPDATE verifications SET state='unknown' WHERE id=?").run(id);throw error;}
    const completed=new Promise<number|null>(resolve=>{client.onClose=resolve;});
    client.onOutput=chunk=>{if(output.length+chunk.length>1024*1024){overflow=true;void client.stop().catch(()=>{});}else output=Buffer.concat([output,chunk]);};
    const timeout=setTimeout(()=>{interrupted=true;void client.stop().catch(()=>{});},120000);
    const done=(async()=>{
      let state='unknown';let message='';
      try {const exit=await completed;await client.stop();state=interrupted?'interrupted':overflow?'failed':exit===0?'passed':(exit===126||exit===127)?'environment':'failed';
        if(state==='passed' && await fingerprint(repo.path)!==before)state='stale';
      }catch(error){message=String(redact(String(error)));}
      finally{clearTimeout(timeout);}
      this.store.db.prepare('UPDATE verifications SET state=?,output=? WHERE id=?').run(state,String(redact(output.toString('utf8')))+(message?'\n'+message:''),id);
      const event=this.store.event(taskId,null,'verification',{id,repositoryId,state,command});if(!this.store.listener)this.notify(event);this.active.delete(id);
    })();
    this.active.set(id,{taskId,client,done,interrupt:()=>{interrupted=true;}});return{id,state:'running'};
  }
  async stopTask(taskId:string){
    for(const entry of [...this.active.values()].filter(v=>v.taskId===taskId)){entry.interrupt();await entry.client.stop();await entry.done;}
  }
  async reconcile(id:string){const row=this.store.db.prepare("SELECT task_id FROM verifications WHERE id=? AND state='unknown'").get(id) as {task_id:string}|undefined;if(!row)throw new AppError(409,'Verifica non incerta');await new ProcessLeases(this.store).reconcile('verification',id);this.store.db.prepare("UPDATE verifications SET state='interrupted' WHERE id=?").run(id);return{state:'interrupted',result:'unknown'};}
  async shutdown(){await Promise.allSettled([...this.active.values()].map(async entry=>{entry.interrupt();await entry.client.stop();await entry.done;}));}
  async list(taskId:string){
    this.store.task(taskId);
    const rows=this.store.db.prepare('SELECT * FROM verifications WHERE task_id=? ORDER BY created_at DESC').all(taskId) as {id:string;command:string;fingerprint:string;state:string}[];
    for(const row of rows){
      if(row.state!=='passed')continue;
      const input=JSON.parse(row.command);const repo=this.store.db.prepare('SELECT path FROM task_repositories WHERE task_id=? AND repository_id=?').get(taskId,input.repositoryId) as {path:string}|undefined;
      if(!repo || await fingerprint(repo.path).catch(()=>null)!==row.fingerprint){row.state='stale';this.store.db.prepare("UPDATE verifications SET state='stale' WHERE id=?").run(row.id);}
    }
    return rows.map(row=>{const command=JSON.parse(row.command);const repo=this.store.db.prepare('SELECT name FROM repositories WHERE id=?').get(command.repositoryId) as {name:string}|undefined;return{...row,command,repositoryName:repo?.name??'Repository non disponibile'};});
  }
}
