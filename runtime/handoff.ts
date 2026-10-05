import { Store } from './storage.js';
import { RunManager } from './runs.js';
import { createCheckpoint, contextPack, fingerprint, type Manifest } from './checkpoint.js';
import { AppError, now, redact } from './protocol.js';
import type { Verifications } from './verification.js';

type Handoff = {id:string;task_id:string;profile_id:string;state:string;checkpoint_id:string|null;context:string|null;context_hash:string|null;successor_id:string|null;error:string|null};
export class Handoffs {
  private pending = new Map<string,Promise<unknown>>();
  constructor(private store: Store,private runs:RunManager,private verifications?:Verifications){}
  get(id:string){const row=this.store.db.prepare('SELECT * FROM handoffs WHERE id=?').get(id) as Handoff|undefined;if(!row)throw new AppError(404,'Passaggio non trovato');return row;}
  async prepare(taskId:string,profileId:string,id:string){
    this.store.task(taskId);
    const profile=this.store.db.prepare('SELECT capabilities FROM profiles WHERE id=? AND enabled=1').get(profileId) as {capabilities:string}|undefined;
    if(!profile || !JSON.parse(profile.capabilities).modes?.length)throw new AppError(409,'Destinatario non verificato');
    const old=this.store.db.prepare('SELECT * FROM handoffs WHERE id=?').get(id) as Handoff|undefined;
    if(old && (old.task_id!==taskId||old.profile_id!==profileId))throw new AppError(409,'Identificativo passaggio riutilizzato');
    if(old?.state==='cancelled')throw new AppError(409,'Passaggio annullato: usa una nuova intenzione');
    const successor=this.store.db.prepare('SELECT run_id FROM run_requests WHERE id=?').get(id) as {run_id:string}|undefined;
    if(old&&successor){this.store.db.prepare("UPDATE handoffs SET state='started',successor_id=? WHERE id=?").run(successor.run_id,id);return this.get(id);}
    if(this.pending.has(id))return this.pending.get(id);
    if(old && ['preview','started'].includes(old.state))return old;
    if(!old)this.store.db.prepare('INSERT INTO handoffs(id,task_id,profile_id,state,created_at) VALUES(?,?,?,?,?)').run(id,taskId,profileId,'stopping',now());
    const work=this.prepareOnce(id).finally(()=>this.pending.delete(id));this.pending.set(id,work);return work;
  }
  private async prepareOnce(id:string){
    const row=this.get(id);
    try {
      await this.verifications?.stopTask(row.task_id);
      const active=this.store.db.prepare("SELECT id,state FROM runs WHERE task_id=? AND state IN ('starting','running','stopping','waiting_permission','unknown')").get(row.task_id) as {id:string;state:string}|undefined;
      if(active){if(active.state==='unknown')throw new AppError(409,'Writer incerto: riconciliazione richiesta prima del passaggio');await this.runs.stop(active.id);}
      this.store.db.prepare("UPDATE handoffs SET state='checkpoint',error=NULL WHERE id=?").run(id);
      const checkpoint=await createCheckpoint(this.store,row.task_id);
      const pack=contextPack(this.store,row.task_id,48000);
      this.store.db.prepare("UPDATE handoffs SET state='preview',checkpoint_id=?,context=?,context_hash=? WHERE id=?").run(checkpoint.id,pack.content,pack.hash,id);
      this.store.event(row.task_id,null,'handoff',{id,state:'preview',checkpointId:checkpoint.id,profileId:row.profile_id});
      return this.get(id);
    }catch(error){this.store.db.prepare("UPDATE handoffs SET state='unknown',error=? WHERE id=?").run(String(redact(String(error))),id);throw error;}
  }
  async confirm(id:string,hash:string,prompt:string,mode:'agent'|'plan',secret?:string,effort?:string,queueId?:string){
    const row=this.get(id);
    if(row.context_hash!==hash)throw new AppError(409,'Anteprima non corrispondente');
    if(row.successor_id)return this.runs.start(row.task_id,row.profile_id,prompt,id,mode,secret,effort,row.context??undefined,id,queueId);
    if(!['preview','starting'].includes(row.state)||!row.context||row.context_hash!==hash)throw new AppError(409,'Anteprima non valida o passaggio non pronto');
    const existing=this.store.db.prepare('SELECT run_id FROM run_requests WHERE id=?').get(id) as {run_id:string}|undefined;
    if(existing){const run=await this.runs.start(row.task_id,row.profile_id,prompt,id,mode,secret,effort,row.context,id,queueId);this.store.db.prepare("UPDATE handoffs SET state='started',successor_id=? WHERE id=?").run(existing.run_id,id);return run;}
    const saved=this.store.db.prepare('SELECT manifest FROM checkpoints WHERE id=?').get(row.checkpoint_id) as {manifest:string};
    const manifest=JSON.parse(saved.manifest) as Manifest;
    for(const repo of manifest.repositories){
      const current=this.store.db.prepare('SELECT path FROM task_repositories WHERE task_id=? AND repository_id=?').get(row.task_id,repo.repositoryId) as {path:string};
      if(await fingerprint(current.path)!==repo.fingerprint)throw new AppError(409,'File o staging cambiati dopo l’anteprima: annulla e prepara un nuovo passaggio');
    }
    this.store.db.prepare("UPDATE handoffs SET state='starting' WHERE id=?").run(id);
    let result:{id:string};
    try{result=await this.runs.start(row.task_id,row.profile_id,prompt,id,mode,secret,effort,row.context,id,queueId) as {id:string};}
    catch(error){if(!this.store.db.prepare('SELECT 1 FROM run_requests WHERE id=?').get(id))this.store.db.prepare("UPDATE handoffs SET state='preview' WHERE id=?").run(id);throw error;}
    this.store.db.prepare("UPDATE handoffs SET state='started',successor_id=? WHERE id=?").run(result.id,id);
    this.store.event(row.task_id,null,'handoff',{id,state:'started',runId:result.id});return result;
  }
  cancel(id:string){const row=this.get(id);if(row.successor_id||row.state==='starting')throw new AppError(409,'Passaggio già avviato');this.store.db.prepare("UPDATE handoffs SET state='cancelled' WHERE id=?").run(id);return {cancelled:true};}
}
