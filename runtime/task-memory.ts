import {randomUUID} from 'node:crypto';
import {Store} from './storage.js';
import {AppError,now} from './protocol.js';
import {Verifications} from './verification.js';
type Criterion={id:string;task_id:string;content:string;revision:number;state:string;verification_id:string|null;override_reason:string|null};
export class TaskMemory {
  constructor(private store:Store,private verifications:Verifications){}
  async status(taskId:string){
    this.store.task(taskId);const verifications=await this.verifications.list(taskId);
    const rows=this.store.db.prepare('SELECT * FROM criteria WHERE task_id=? ORDER BY created_at,id').all(taskId) as Criterion[];
    this.store.db.transaction(()=>{
      for(const row of rows)if(row.state==='verified'&&!verifications.some(v=>v.id===row.verification_id&&v.state==='passed')){row.state='stale';this.store.db.prepare("UPDATE criteria SET state='stale' WHERE id=?").run(row.id);}
      if(!rows.length||rows.some(r=>!['verified','waived'].includes(r.state)))this.store.db.prepare("UPDATE tasks SET status='ready' WHERE id=? AND status IN ('completed','review')").run(taskId);
    })();
    return {criteria:rows,completed:rows.filter(r=>['verified','waived'].includes(r.state)).length,total:rows.length,
      decisions:this.store.db.prepare('SELECT * FROM decisions WHERE task_id=? ORDER BY created_at,id').all(taskId),status:this.store.task(taskId).status};
  }
  edit(taskId:string,content:string,reason:string,id?:string,revision?:number){
    this.store.task(taskId);const criterion=id??randomUUID();
    return this.store.db.transaction(()=>{
      if(id){const old=this.store.db.prepare('SELECT * FROM criteria WHERE id=? AND task_id=?').get(id,taskId) as Criterion|undefined;
        if(!old||revision!==old.revision)throw new AppError(409,'Il criterio è cambiato: ricarica prima di modificare');
        this.store.db.prepare("UPDATE criteria SET content=?,revision=revision+1,state='open',verification_id=NULL,override_reason=NULL,updated_at=? WHERE id=?").run(content,now(),id);
      }else this.store.db.prepare('INSERT INTO criteria(id,task_id,content,created_at,updated_at) VALUES(?,?,?,?,?)').run(criterion,taskId,content,now(),now());
      const current=this.store.db.prepare('SELECT * FROM criteria WHERE id=?').get(criterion) as Criterion;
      this.store.db.prepare('INSERT INTO criteria_history VALUES(?,?,?,?,?)').run(criterion,current.revision,content,reason,now());
      this.store.db.prepare("UPDATE tasks SET status='ready' WHERE id=?").run(taskId);this.store.event(taskId,null,'criterion',{id:criterion,revision:current.revision,reason});return current;
    })();
  }
  async accept(taskId:string,id:string,revision:number,verificationId?:string,overrideReason?:string){
    const status=await this.status(taskId);const row=status.criteria.find(c=>c.id===id);
    if(!row||row.revision!==revision)throw new AppError(409,'Criterio non trovato o revisione cambiata');
    if(Boolean(verificationId)===Boolean(overrideReason))throw new AppError(400,'Seleziona una verifica valida oppure una deroga motivata');
    if(verificationId&&!this.store.db.prepare("SELECT 1 FROM verifications WHERE id=? AND task_id=? AND state='passed'").get(verificationId,taskId))throw new AppError(409,'Verifica mancante, obsoleta o non riuscita');
    this.store.db.prepare('UPDATE criteria SET state=?,verification_id=?,override_reason=?,updated_at=? WHERE id=?').run(verificationId?'verified':'waived',verificationId??null,overrideReason??null,now(),id);
    this.store.event(taskId,null,'criterion_accepted',{id,revision,verificationId,overrideReason,source:'user'});return this.status(taskId);
  }
  decision(taskId:string,content:string,supersedes?:string){
    this.store.task(taskId);const id=randomUUID();return this.store.db.transaction(()=>{
      let revision=1;
      if(supersedes){const old=this.store.db.prepare("SELECT revision FROM decisions WHERE id=? AND task_id=? AND state='active'").get(supersedes,taskId) as {revision:number}|undefined;if(!old)throw new AppError(409,'Decisione già superata o esterna al task');revision=old.revision+1;this.store.db.prepare("UPDATE decisions SET state='superseded' WHERE id=?").run(supersedes);}
      this.store.db.prepare('INSERT INTO decisions(id,task_id,content,source,revision,supersedes,created_at) VALUES(?,?,?,?,?,?,?)').run(id,taskId,content,'user-confirmed',revision,supersedes??null,now());
      this.store.event(taskId,null,'decision',{id,content,revision,supersedes,source:'user-confirmed'});return{id,revision};
    })();
  }
  async complete(taskId:string){
    const status=await this.status(taskId);if(!status.total||status.completed!==status.total)throw new AppError(409,'Definisci e verifica tutti i criteri prima di completare il lavoro');
    if(this.store.db.prepare("SELECT 1 FROM runs WHERE task_id=? AND state IN ('starting','running','stopping','unknown')").get(taskId)||this.store.db.prepare("SELECT 1 FROM verifications WHERE task_id=? AND state IN ('running','unknown')").get(taskId))throw new AppError(409,'Esecuzione ancora attiva o incerta');
    this.store.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(taskId);this.store.event(taskId,null,'task_completed',{source:'user',criteria:status.criteria.map(c=>({id:c.id,revision:c.revision,state:c.state}))});return{status:'completed'};
  }
}
