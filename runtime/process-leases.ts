import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {Store} from './storage.js';
import {AppError,now} from './protocol.js';
import type {JsonProcess} from './process.js';
export type ProcessIdentity={pid:number;group:number;started:string};
export function processSnapshot():ProcessIdentity[]{
  return execFileSync('/bin/ps',['-axo','pid=,pgid=,lstart='],{encoding:'utf8'}).split('\n').flatMap(row=>{const m=row.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);return m?[{pid:Number(m[1]),group:Number(m[2]),started:m[3]!}]:[];});
}
export class ProcessLeases {
  constructor(private store:Store,private snapshot=processSnapshot,private signal=(pid:number,signal:NodeJS.Signals)=>process.kill(pid,signal)){}
  track(kind:string,ownerId:string,client:JsonProcess){
    const pid=client.child.pid;const first=this.snapshot();const leader=first.find(p=>p.pid===pid&&p.group===pid);
    if(!pid)throw new AppError(409,'Identità del processo non verificabile');
    const id=randomUUID();const members=new Map<number,ProcessIdentity>(first.filter(p=>p.group===pid).map(p=>[p.pid,p]));
    this.store.db.prepare('INSERT INTO process_leases VALUES(?,?,?,?,?,?,?,?)').run(id,kind,ownerId,pid,leader?.started??'',JSON.stringify([...members.values()]),'active',now());
    let failed=false;
    const timer=setInterval(()=>{
      try{
        const current=this.snapshot();
        if(!leader||!current.some(p=>p.pid===pid&&p.started===leader.started))return;
        let changed=false;for(const child of current.filter(p=>p.group===pid)){if(members.get(child.pid)?.started!==child.started){members.set(child.pid,child);changed=true;}}
        if(changed)this.store.db.prepare('UPDATE process_leases SET members=?,updated_at=? WHERE id=?').run(JSON.stringify([...members.values()]),now(),id);
      }catch{failed=true;void client.stop().catch(()=>{});}
    },500);timer.unref();
    client.child.once('close',()=>{clearInterval(timer);if(!this.store.db.open)return;
      try{const remaining=this.snapshot().some(p=>p.group===pid);this.store.db.prepare('UPDATE process_leases SET state=?,updated_at=? WHERE id=?').run(remaining||failed?'unknown':'stopped',now(),id);}catch{ /* An active lease requires reconciliation after restart. */ }
    });
  }
  async reconcile(kind:string,ownerId:string){
    const leases=this.store.db.prepare('SELECT * FROM process_leases WHERE owner_kind=? AND owner_id=?').all(kind,ownerId) as {id:string;leader:number;members:string}[];
    if(!leases.length)throw new AppError(409,'Nessuna identità durevole disponibile: arresto non dimostrabile automaticamente');
    for(const lease of leases){
      const members=JSON.parse(lease.members) as ProcessIdentity[];
      for(const signal of ['SIGTERM','SIGKILL'] as const){
        for(const member of members){const current=this.snapshot().find(p=>p.pid===member.pid);if(current?.started===member.started&&current.group===member.group){try{this.signal(member.pid,signal);}catch(e:any){if(e.code!=='ESRCH')throw e;}}}
        for(let i=0;i<15&&this.snapshot().some(p=>p.group===lease.leader);i++)await new Promise(resolve=>setTimeout(resolve,50));
      }
      if(this.snapshot().some(p=>p.group===lease.leader))throw new AppError(409,'Gruppo attivo o PID riutilizzato: nessun nuovo writer autorizzato');
      this.store.db.prepare("UPDATE process_leases SET state='stopped',updated_at=? WHERE id=?").run(now(),lease.id);
    }
    return{stopped:true,scope:'observed-process-groups'};
  }
}
