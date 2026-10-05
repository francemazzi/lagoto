import {access,lstat,mkdir,realpath,stat} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join} from 'node:path';
import {Store} from './storage.js';
import {AppError,now,redact} from './protocol.js';
import {addRepository,git,githubIdentity,repositoryIdentity,safeRemoteURL} from './git.js';
import {cleanEnvironment,executable,JsonProcess} from './process.js';
import {ProcessLeases} from './process-leases.js';

type Repository={id:string;project_id:string;name:string;path:string;git_root:string|null;remote:string|null;identity:string|null};
type Clone={id:string;projectId:string;source:string;destination:string;state:string;progress:string;repositoryId?:string;error?:string};
type Job={process?:JsonProcess;cancelled:boolean;done:Promise<void>};
const message=(error:unknown)=>String(redact(error instanceof Error?error.message:String(error)));

export function cloneSource(source:string){
  if(!source || /[\x00-\x1f\x7f]/.test(source) || source.startsWith('-'))throw new AppError(400,'Indirizzo Git non valido');
  if(isAbsolute(source))return source;
  if(source.includes(' '))throw new AppError(400,'Indirizzo Git non valido');
  if(/^git@[\w.-]+:[\w./-]+$/.test(source))return source;
  let url:URL;try{url=new URL(source);}catch{throw new AppError(400,'Usa un URL HTTPS/SSH o un percorso Git assoluto');}
  if(!['https:','ssh:'].includes(url.protocol)||url.password||url.search||url.hash||(url.protocol==='https:'&&url.username))
    throw new AppError(400,'Usa HTTPS/SSH senza credenziali o parametri; il login resta nel credential store Git');
  return safeRemoteURL(source);
}

export class Repositories {
  private jobs=new Map<string,Job>();
  private leases:ProcessLeases;
  constructor(private store:Store,private makeProcess=(args:string[],cwd:string)=>new JsonProcess(executable('git')!,args,cwd,cleanEnvironment({GIT_TERMINAL_PROMPT:'0',GIT_SSH_COMMAND:'ssh -oBatchMode=yes',GIT_LFS_SKIP_SMUDGE:'1'}),'text')){this.leases=new ProcessLeases(store);}
  get(projectId:string,id:string){
    this.store.project(projectId);
    const repo=this.store.db.prepare('SELECT * FROM repositories WHERE project_id=? AND id=?').get(projectId,id) as Repository|undefined;
    if(!repo)throw new AppError(404,'Repository esterno al progetto o non trovato');return repo;
  }
  async inspect(projectId:string,id:string){
    const repo=this.get(projectId,id);
    try{
      await access(repo.path);
      if(!repo.git_root)return{...repo,identity:undefined,availability:'candidate',candidates:[]};
      const identity=JSON.stringify(await repositoryIdentity(repo.path,repo.git_root));
      if(repo.identity&&repo.identity!==identity)throw new AppError(409,'La cartella contiene un repository diverso da quello registrato');
      if(!repo.identity)this.store.db.prepare('UPDATE repositories SET identity=? WHERE id=?').run(identity,id);
      const candidates=[];
      for(const name of (await git(repo.path,['remote'])).split('\n').filter(Boolean)){
        const raw=await git(repo.path,['remote','get-url',name]);const key=githubIdentity(raw);
        let visible:string;try{visible=String(redact(safeRemoteURL(raw)));}catch{visible='URL con credenziali o parametri: correggi la configurazione Git';}
        candidates.push({name,url:visible,github:key});
      }
      return {...repo,identity:undefined,availability:'ready',branch:await git(repo.path,['branch','--show-current']),
        status:await git(repo.path,['status','--short']),candidates,githubVerified:false};
    }catch(error){return{...repo,identity:undefined,availability:'unavailable',candidates:[],error:message(error)};}
  }
  async selectRemote(projectId:string,id:string,name:string){
    const repo=this.get(projectId,id);const detail=await this.inspect(projectId,id);
    if(detail.availability!=='ready')throw new AppError(409,'Repository non disponibile');
    const candidate=detail.candidates.find(c=>c.name===name);
    if(!candidate?.github)throw new AppError(400,'Remote GitHub non presente');
    this.store.db.prepare('UPDATE repositories SET remote=? WHERE id=?').run(`https://github.com/${candidate.github}`,repo.id);
    return this.inspect(projectId,id);
  }
  async relink(projectId:string,id:string,directory:string){
    const repo=this.get(projectId,id);const target=await realpath(directory);
    if(target===repo.path)return this.inspect(projectId,id);
    let originalPresent=false;try{await access(repo.path);originalPresent=true;}catch(error:any){if(error.code!=='ENOENT')throw error;}
    if(originalPresent)throw new AppError(409,'La cartella originale esiste ancora: aggiungi il secondo clone separatamente');
    if(!repo.identity)throw new AppError(409,'Identità precedente non disponibile: ripristina il percorso originale prima del ricollegamento');
    const root=repo.git_root?await realpath(await git(target,['rev-parse','--show-toplevel'])):null;
    if(root&&root!==target)throw new AppError(400,'Seleziona la root del repository spostato');
    if(JSON.stringify(await repositoryIdentity(target,root))!==repo.identity)throw new AppError(409,'Identità differente: non è la stessa cartella spostata su questo volume');
    const works=this.store.db.prepare('SELECT tr.* FROM task_repositories tr WHERE repository_id=?').all(id) as {path:string;task_id:string}[];
    for(const work of works){
      if(this.store.db.prepare("SELECT 1 FROM runs WHERE task_id=? AND state IN ('starting','running','stopping','waiting_permission','unknown')").get(work.task_id)||this.store.db.prepare("SELECT 1 FROM verifications WHERE task_id=? AND state IN ('running','unknown')").get(work.task_id))
        throw new AppError(409,'Arresta e riconcilia i processi prima di riparare i worktree');
    }
    if(root&&works.length)await git(root,['worktree','repair','--',...works.map(w=>w.path)]);
    this.store.db.prepare('UPDATE repositories SET path=?,git_root=?,name=? WHERE id=?').run(target,root,basename(target),id);
    return this.inspect(projectId,id);
  }
  clone(id:string){
    const row=this.store.db.prepare("SELECT state,payload FROM repository_operations WHERE id=? AND kind='clone'").get(id) as {state:string;payload:string}|undefined;
    if(!row)throw new AppError(404,'Clonazione non trovata');return{...JSON.parse(row.payload),state:row.state} as Clone;
  }
  list(projectId:string){this.store.project(projectId);return(this.store.db.prepare("SELECT id FROM repository_operations WHERE project_id=? AND kind='clone' ORDER BY created_at DESC").all(projectId) as {id:string}[]).map(r=>this.clone(r.id));}
  private save(value:Clone){this.store.db.prepare('UPDATE repository_operations SET state=?,repository_id=?,payload=?,updated_at=? WHERE id=?').run(value.state,value.repositoryId??null,JSON.stringify(value),now(),value.id);}
  async startClone(projectId:string,id:string,source:string,destination:string){
    this.store.project(projectId);cloneSource(source);
    if(!isAbsolute(destination)||['.','..',''].includes(basename(destination)))throw new AppError(400,'Scegli una nuova cartella con percorso assoluto');
    const parent=await realpath(dirname(destination));destination=join(parent,basename(destination));
    const old=this.store.db.prepare('SELECT 1 FROM repository_operations WHERE id=?').get(id);
    if(old){const prior=this.clone(id);if(prior.projectId!==projectId||prior.source!==source||prior.destination!==destination)throw new AppError(409,'Richiesta di clonazione riutilizzata');return prior;}
    if(!executable('git'))throw new AppError(404,'Git non disponibile');
    // mkdir is the exclusive reservation. Clone only into the directory created by this operation.
    // Failed/cancelled destinations are kept for inspection and never recursively removed or reused.
    await mkdir(destination,{mode:0o700});
    const info=await stat(destination);
    const value:Clone={id,projectId,source,destination,state:'starting',progress:''};
    this.store.db.prepare('INSERT INTO repository_operations VALUES(?,?,?,?,?,?,?,?)').run(id,projectId,null,'clone',value.state,JSON.stringify({...value,owner:{device:info.dev,inode:info.ino}}),now(),now());
    const job:Job={cancelled:false,done:Promise.resolve()};this.jobs.set(id,job);
    job.done=this.runClone(value,job).finally(()=>this.jobs.delete(id));return this.clone(id);
  }
  private async runClone(value:Clone,job:Job){
    try{
      // Suppress templates/hooks and LFS smudge; cloned code is never executed on arrival.
      const client=this.makeProcess(['-c','core.hooksPath=/dev/null','-c','protocol.ext.allow=never','clone','--template=','--progress','--',value.source,value.destination],dirname(value.destination));job.process=client;
      this.leases.track('clone',value.id,client);value.state='running';this.save(value);
      client.onOutput=bytes=>{value.progress=(value.progress+message(bytes.toString('utf8'))).slice(-8000);this.save(value);};
      const timeout=setTimeout(()=>{job.cancelled=true;void client.stop().catch(()=>{});},10*60*1000);
      let code:number|null;
      try{code=await new Promise<number|null>(resolve=>{client.onClose=resolve;});}finally{clearTimeout(timeout);}
      await client.stop();
      if(job.cancelled){value.state='cancelled';value.progress+='\nClonazione annullata. La cartella parziale resta disponibile.';}
      else if(code!==0)throw new AppError(502,'Git non ha completato il clone. Consulta il progresso e verifica accesso/indirizzo.');
      else{
        if(!(await lstat(join(value.destination,'.git'))).isDirectory())throw new AppError(409,'Clone Git non valido');
        const repo=await addRepository(this.store,value.projectId,value.destination) as Repository;
        value.repositoryId=repo.id;value.state='completed';
      }
    }catch(error){value.error=message(error);value.state=job.cancelled?'unknown':'failed';}
    this.save(value);
  }
  async cancelClone(id:string){
    const value=this.clone(id);const job=this.jobs.get(id);
    if(job){job.cancelled=true;value.state='stopping';this.save(value);await job.process?.stop();await job.done;}
    else if(value.state==='unknown'){
      await this.leases.reconcile('clone',id);value.state='cancelled';value.progress+='\nProcessi riconciliati dopo il riavvio; cartella parziale conservata.';this.save(value);
    }
    return this.clone(id);
  }
  async shutdown(){for(const id of [...this.jobs.keys()])await this.cancelClone(id);}
}
