import {createHash} from 'node:crypto';
import {Store} from './storage.js';
import {git,safeRemoteURL,type TaskRepository} from './git.js';
import {fingerprint,createCheckpoint} from './checkpoint.js';
import {AppError,now,redact} from './protocol.js';
import {readFile,writeFile,lstat,readlink} from 'node:fs/promises';
import {join} from 'node:path';

type Selection={repositoryId:string;paths:string[];remote?:string};
type Item=Selection & {name:string;path:string;branch:string;base:string;fingerprint:string;diff:string;remoteURL?:string;state:string;commit?:string;error?:string;indexBefore?:string;indexPrepared?:string};
type Delivery={id:string;taskId:string;message:string;hash:string;items:Item[];checkpointId:string;state:string};
export function deliveryView(delivery:Delivery){return{...delivery,items:delivery.items.map(({indexBefore:_indexBefore,indexPrepared:_indexPrepared,...item})=>item)};}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class Deliveries {
  private pending=new Map<string,Promise<Delivery>>();
  constructor(private store:Store,private execute=git){}
  get(id:string){const row=this.store.db.prepare("SELECT payload FROM external_actions WHERE id=? AND kind='delivery'").get(id) as {payload:string}|undefined;if(!row)throw new AppError(404,'Consegna non trovata');return JSON.parse(row.payload) as Delivery;}
  private save(value:Delivery){this.store.db.prepare('UPDATE external_actions SET state=?,payload=? WHERE id=?').run(value.state,JSON.stringify(value),value.id);}
  private idle(taskId:string){
    if(this.store.db.prepare("SELECT 1 FROM runs WHERE task_id=? AND state IN ('starting','running','stopping','waiting_permission','unknown')").get(taskId)||this.store.db.prepare("SELECT 1 FROM verifications WHERE task_id=? AND state IN ('running','unknown')").get(taskId))throw new AppError(409,'Arresta e riconcilia i processi prima della consegna');
  }
  async preview(taskId:string,id:string,message:string,selections:Selection[]){
    this.store.task(taskId);this.idle(taskId);
    const existing=this.store.db.prepare('SELECT 1 FROM external_actions WHERE id=?').get(id);
    if(existing){const old=this.get(id);if(old.taskId!==taskId||old.message!==message||digest(old.items.map(({repositoryId,paths,remote})=>({repositoryId,paths,remote})))!==digest(selections))throw new AppError(409,'Identificativo consegna riutilizzato');return old;}
    if(new Set(selections.map(s=>s.repositoryId)).size!==selections.length)throw new AppError(400,'Repository duplicato');
    const checkpoint=await createCheckpoint(this.store,taskId);const items:Item[]=[];
    for(const selection of selections){
      const repo=this.store.db.prepare('SELECT * FROM task_repositories WHERE task_id=? AND repository_id=?').get(taskId,selection.repositoryId) as TaskRepository|undefined;
      if(!repo)throw new AppError(403,'Repository esterno al task');
      const changed=(await git(repo.path,['diff','--name-only','-z','HEAD','--'])).split('\0').filter(Boolean);
      changed.push(...(await git(repo.path,['ls-files','--others','--exclude-standard','-z'])).split('\0').filter(Boolean));
      if(selection.paths.some(p=>!changed.includes(p)||p.split('/').includes('..')||p.startsWith('/')||p.includes('\0')))throw new AppError(400,'Seleziona solo file modificati del repository');
      if(await git(repo.path,['branch','--show-current'])!==repo.branch)throw new AppError(409,'Branch del worktree cambiato');
      let remoteURL:string|undefined;
      if(selection.remote){const remotes=(await git(repo.path,['remote'])).split('\n');if(!remotes.includes(selection.remote))throw new AppError(400,'Remote non disponibile');remoteURL=safeRemoteURL(await git(repo.path,['remote','get-url','--push',selection.remote]));}
      let diff=await git(repo.path,['diff','--no-ext-diff','--no-textconv','HEAD','--',...selection.paths]);
      const newPaths=(await git(repo.path,['ls-files','--others','--exclude-standard','-z'])).split('\0').filter(p=>selection.paths.includes(p));
      for(const path of newPaths){const absolute=join(repo.path,path);const stat=await lstat(absolute);
        if(stat.isSymbolicLink())diff+=`\nNuovo link: ${path} → ${await readlink(absolute)}\n`;
        else if(stat.size>1024*1024)diff+=`\nNuovo file: ${path} (${stat.size} byte; anteprima non disponibile)\n`;
        else {const bytes=await readFile(absolute);diff+=`\nNuovo file: ${path}\n${bytes.includes(0)?`Binario, ${bytes.length} byte, SHA256 ${createHash('sha256').update(bytes).digest('hex')}`:String(redact(bytes.toString('utf8')))}\n`;}
      }
      const name=(this.store.db.prepare('SELECT name FROM repositories WHERE id=?').get(repo.repository_id) as {name:string}).name;
      items.push({...selection,name,path:repo.path,branch:repo.branch,base:await git(repo.path,['rev-parse','HEAD']),fingerprint:await fingerprint(repo.path),diff,remoteURL,state:'pending'});
    }
    const value:Delivery={id,taskId,message,items,hash:digest({taskId,message,items}),checkpointId:checkpoint.id,state:'preview'};
    this.store.db.prepare('INSERT INTO external_actions VALUES(?,?,?,?,?,?)').run(id,taskId,'delivery','preview',JSON.stringify(value),now());return value;
  }
  async confirm(id:string,hash:string){
    const delivery=this.get(id);if(delivery.hash!==hash)throw new AppError(409,'Anteprima non corrispondente');
    if(delivery.state==='restored')throw new AppError(409,'Archivio ripristinato: revisiona nuovamente la consegna');
    if(this.pending.has(id))return this.pending.get(id)!;
    const job=this.deliver(delivery).finally(()=>this.pending.delete(id));this.pending.set(id,job);return job;
  }
  private async deliver(delivery:Delivery){
    this.idle(delivery.taskId);delivery.state='executing';this.save(delivery);
    for(const item of delivery.items){
      if(item.state==='delivered')continue;
      try{
        const marker=`Lagoto-Delivery: ${delivery.id}/${item.repositoryId}`;
        if(item.state==='committing'||item.state==='unknown'){
          const head=await git(item.path,['rev-parse','HEAD']);
          if(head!==item.base && await git(item.path,['rev-parse',head+'^'])===item.base && (await git(item.path,['log','-1','--format=%B'])).split('\n').includes(marker)){item.commit=head;item.state='committed';this.save(delivery);}
          else if(head===item.base && await fingerprint(item.path)===item.fingerprint)item.state='pending';
          else throw new AppError(409,'Esito del commit incerto: nessuna ripetizione automatica');
        }
        if(item.state==='pending'){
          if(await fingerprint(item.path)!==item.fingerprint)throw new AppError(409,'File o staging cambiati dopo la revisione');
          item.state='committing';this.save(delivery);
          // --only preserves unrelated staged work. Keep the exact index for a failed commit.
          const indexPath=await git(item.path,['rev-parse','--path-format=absolute','--git-path','index']);
          item.indexBefore=(await readFile(indexPath)).toString('base64');this.save(delivery);
          const untracked=(await git(item.path,['ls-files','--others','--exclude-standard','-z'])).split('\0').filter(p=>item.paths.includes(p));
          if(untracked.length)await git(item.path,['add','--intent-to-add','--',...untracked]);
          item.indexPrepared=digest((await readFile(indexPath)).toString('base64'));this.save(delivery);
          try{await this.execute(item.path,['commit','--only','-m',delivery.message,'-m',marker,'--',...item.paths]);}
          catch(error){
            if(await git(item.path,['rev-parse','HEAD'])===item.base && digest((await readFile(indexPath)).toString('base64'))===item.indexPrepared){await writeFile(indexPath,Buffer.from(item.indexBefore,'base64'));item.state='pending';}
            throw error;
          }
          item.commit=await git(item.path,['rev-parse','HEAD']);item.state='committed';this.save(delivery);
        }
        if(item.remote){
          if(await git(item.path,['remote','get-url','--push',item.remote])!==item.remoteURL)throw new AppError(409,'Remote cambiato dopo la revisione');
          if(await git(item.path,['rev-parse','HEAD'])!==item.commit)throw new AppError(409,'Il branch è cambiato: push interrotto');
          const ref=`refs/heads/${item.branch}`;
          const remote=await this.execute(item.path,['ls-remote',item.remoteURL!,ref]);
          if(remote.split(/\s/)[0]!==item.commit){item.state='pushing';this.save(delivery);await this.execute(item.path,['push','--porcelain',item.remoteURL!,`${item.commit}:${ref}`]);
            if((await this.execute(item.path,['ls-remote',item.remoteURL!,ref])).split(/\s/)[0]!==item.commit)throw new AppError(409,'Push senza conferma del remote');}
        }
        item.state='delivered';delete item.error;this.save(delivery);
      }catch(error){item.error=String(redact(error instanceof Error?error.message:String(error)));if(item.state==='committing')item.state='unknown';delivery.state='failed';this.save(delivery);return delivery;}
    }
    delivery.state='delivered';this.save(delivery);this.store.event(delivery.taskId,null,'delivery',{id:delivery.id,state:'delivered',commits:delivery.items.map(i=>({repositoryId:i.repositoryId,commit:i.commit,pushed:Boolean(i.remote)}))});return delivery;
  }
}
