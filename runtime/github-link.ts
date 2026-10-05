import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Store} from './storage.js';
import {AppError,now,redact} from './protocol.js';
import {git,gitBytes} from './git.js';
import {fingerprint} from './checkpoint.js';
import {cleanEnvironment,executable} from './process.js';

const exec=promisify(execFile);
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const secretName=(name:string)=>/(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|credentials\.json)$|\.(?:pem|p12|pfx|key)$/i.test(name);
const secretBytes=(bytes:Buffer)=>/-----BEGIN [\w ]*PRIVATE KEY-----|\b(?:sk-[\w-]{20,}|ghp_[\w]{20,}|github_pat_[\w]{20,})/.test(bytes.toString('utf8'));
export async function githubCLI(args:string[]){
  const binary=executable('gh');if(!binary)throw new AppError(404,'GitHub CLI non disponibile');
  return(await exec(binary,args,{env:cleanEnvironment({GH_HOST:'github.com',GH_PROMPT_DISABLED:'1'}),timeout:30000,maxBuffer:4*1024*1024})).stdout;
}
type Remote={id:number;full_name:string;private:boolean;description:string|null;owner:{login:string}};
export type LinkOperation={id:string;projectId:string;repositoryId:string;path:string;owner:string;accountId:number;name:string;remoteName:string;url:string;branch:string;head:string;fingerprint:string;hash:string;state:string;step:string;files:string[];commits:number;history:string;unpublished:string;remoteId?:number;error?:string};

/** First publication of an existing committed branch. No implicit commit, staging or account changes. */
export class GitHubLinks {
  private jobs=new Map<string,Promise<void>>();
  constructor(private store:Store,private gh=githubCLI,private executeGit=git){}
  get(id:string){const row=this.store.db.prepare("SELECT state,payload FROM repository_operations WHERE id=? AND kind='github-link'").get(id) as {state:string;payload:string}|undefined;
    if(!row)throw new AppError(404,'Collegamento GitHub non trovato');return{...JSON.parse(row.payload),state:row.state} as LinkOperation;}
  list(projectId:string,repositoryId:string){return(this.store.db.prepare("SELECT id FROM repository_operations WHERE project_id=? AND repository_id=? AND kind='github-link' ORDER BY created_at DESC").all(projectId,repositoryId) as {id:string}[]).map(r=>this.get(r.id));}
  private save(op:LinkOperation){this.store.db.prepare('UPDATE repository_operations SET state=?,payload=?,updated_at=? WHERE id=?').run(op.state,JSON.stringify(op),now(),op.id);}
  async account(){
    const hosts=JSON.parse(await this.gh(['auth','status','--json','hosts'])).hosts;
    const accounts=(hosts?.['github.com']??[]).filter((a:any)=>a.active);
    if(accounts.length!==1||accounts[0].state!=='success')throw new AppError(401,'Seleziona un solo account attivo con gh auth login/switch');
    if(accounts[0].tokenSource!=='keyring')throw new AppError(401,'Configura GitHub CLI con credenziali nel Portachiavi prima della pubblicazione');
    const user=JSON.parse(await this.gh(['api','user']));
    if(user.login!==accounts[0].login)throw new AppError(409,'Account GitHub cambiato durante la verifica');
    return{login:String(user.login),id:Number(user.id)};
  }
  private async remote(owner:string,name:string){
    try{return JSON.parse(await this.gh(['api',`repos/${owner}/${name}`])) as Remote;}
    catch(error:any){if(/\(HTTP 404\)/.test(String(error.stderr??error.message)))return null;throw error;}
  }
  private assertRemote(op:LinkOperation,remote:Remote){
    if(!remote.private||remote.full_name.toLowerCase()!==`${op.owner}/${op.name}`.toLowerCase()||remote.owner.login.toLowerCase()!==op.owner.toLowerCase()||
      (op.remoteId?remote.id!==op.remoteId:remote.description!==`Lagoto operation ${op.id}`))
      throw new AppError(409,'Nome già occupato o identità/visibilità remota cambiata: nessun push autorizzato');
  }
  private idle(repositoryId:string){
    if(this.store.db.prepare("SELECT 1 FROM task_repositories tr JOIN runs r ON r.task_id=tr.task_id WHERE tr.repository_id=? AND r.state IN ('starting','running','waiting_permission','stopping','unknown')").get(repositoryId)||
      this.store.db.prepare("SELECT 1 FROM task_repositories tr JOIN verifications v ON v.task_id=tr.task_id WHERE tr.repository_id=? AND v.state IN ('running','unknown')").get(repositoryId))
      throw new AppError(409,'Arresta e riconcilia il lavoro prima del primo collegamento GitHub');
  }
  private async scanHistory(path:string,head:string){
    const format=await git(path,['rev-parse','--show-object-format']);
    const objects=(await git(path,['rev-list','--objects','--no-object-names',head])).split('\n').filter(Boolean);
    if(objects.length>3000)throw new AppError(413,'Cronologia troppo grande per la scansione iniziale integrata; pubblicazione bloccata');
    for(const oid of objects){
      const type=await git(path,['cat-file','-t',oid]);const bytes=await gitBytes(path,['cat-file',type,oid]);
      if(secretBytes(bytes))throw new AppError(409,'Segreto rilevato nella cronologia destinata a GitHub');
      if(type==='tree')for(let offset=0;offset<bytes.length;){const space=bytes.indexOf(32,offset),zero=bytes.indexOf(0,space);
        if(space<0||zero<0)throw new AppError(409,'Oggetto Git non valido');
        const mode=bytes.subarray(offset,space).toString();const name=bytes.subarray(space+1,zero).toString();
        if(mode==='160000'||secretName(name))throw new AppError(409,'Submodule o file sensibile nella cronologia destinata a GitHub');
        offset=zero+1+(format==='sha256'?32:20);
      }
    }
  }
  async preview(projectId:string,repositoryId:string,id:string,name:string,remoteName:string){
    this.store.project(projectId);this.idle(repositoryId);
    if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)||!name.replaceAll('.','')||!name.replaceAll('-',''))throw new AppError(400,'Nome GitHub non valido');
    if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(remoteName))throw new AppError(400,'Nome remote non valido');
    if(this.store.db.prepare('SELECT 1 FROM repository_operations WHERE id=?').get(id)){
      const old=this.get(id);if(old.projectId!==projectId||old.repositoryId!==repositoryId||old.name!==name||old.remoteName!==remoteName)throw new AppError(409,'Richiesta di collegamento riutilizzata');return old;
    }
    const repo=this.store.db.prepare('SELECT * FROM repositories WHERE project_id=? AND id=?').get(projectId,repositoryId) as {path:string;git_root:string|null}|undefined;
    if(!repo?.git_root)throw new AppError(400,'Prepara prima un repository Git con almeno un commit locale');
    if((await git(repo.path,['remote'])).split('\n').includes(remoteName))throw new AppError(409,'Il nome del remote esiste già: scegli un nome libero');
    const branch=await git(repo.path,['branch','--show-current']);if(!branch)throw new AppError(409,'Seleziona un branch locale prima di pubblicare');
    await git(repo.path,['check-ref-format',`refs/heads/${branch}`]);
    const before=await fingerprint(repo.path);const head=await git(repo.path,['rev-parse','HEAD']);
    await this.scanHistory(repo.path,head);
    if(before!==await fingerprint(repo.path))throw new AppError(409,'File cambiati durante la scansione: ripeti l’anteprima');
    const account=await this.account();
    if(await this.remote(account.login,name))throw new AppError(409,'Nome già occupato su GitHub: scegli un altro nome');
    const op:LinkOperation={id,projectId,repositoryId,path:repo.path,owner:account.login,accountId:account.id,name,remoteName,url:`https://github.com/${account.login}/${name}.git`,branch,head,fingerprint:before,hash:'',state:'preview',step:'prepared',
      files:(await git(repo.path,['ls-tree','-r','--name-only','-z',head])).split('\0').filter(Boolean),commits:Number(await git(repo.path,['rev-list','--count',head])),
      history:await git(repo.path,['log','-30','--format=%h %s',head]),unpublished:await git(repo.path,['status','--short'])};
    op.hash=digest(op);this.store.db.prepare('INSERT INTO repository_operations VALUES(?,?,?,?,?,?,?,?)').run(id,projectId,repositoryId,'github-link',op.state,JSON.stringify(op),now(),now());return op;
  }
  confirm(id:string,hash:string){
    const op=this.get(id);if(op.hash!==hash)throw new AppError(409,'Anteprima non corrispondente');
    if(op.state==='completed'||this.jobs.has(id))return op;
    if(this.store.db.prepare("SELECT 1 FROM repository_operations WHERE repository_id=? AND kind='github-link' AND id<>? AND state IN ('starting','running','stopping','unknown')").get(op.repositoryId,id))throw new AppError(409,'Un altro collegamento è attivo o da riconciliare');
    this.idle(op.repositoryId);op.state='running';delete op.error;this.save(op);
    const job=this.link(op).catch(error=>{op.state=op.step==='creating'?'unknown':'failed';op.error=String(redact(error instanceof Error?error.message:String(error)));this.save(op);}).finally(()=>this.jobs.delete(id));
    this.jobs.set(id,job);return this.get(id);
  }
  private async link(op:LinkOperation){
    const account=await this.account();
    if(account.login!==op.owner||account.id!==op.accountId)throw new AppError(409,'Account GitHub cambiato: ripristina quello approvato nell’anteprima');
    if(await fingerprint(op.path)!==op.fingerprint||await git(op.path,['branch','--show-current'])!==op.branch)throw new AppError(409,'File, indice o branch cambiati dopo l’anteprima; nessun nuovo invio');
    let remote=await this.remote(op.owner,op.name);
    if(!remote){
      if(op.remoteId)throw new AppError(409,'Il repository remoto noto non è accessibile: nessuna ricreazione automatica');
      // A timeout after POST may have created the resource; an existing operation marker reconciles it.
      // A subsequent 404 is insufficient to repeat a POST with unknown outcome.
      if(op.step==='creating')throw new AppError(409,'Creazione con esito incerto e repository non visibile: riconciliazione manuale richiesta');
      op.step='creating';this.save(op);
      remote=JSON.parse(await this.gh(['api','--method','POST','user/repos','-f',`name=${op.name}`,'-F','private=true','-f',`description=Lagoto operation ${op.id}`])) as Remote;
    }
    this.assertRemote(op,remote);op.remoteId=remote.id;op.step='remote_created';this.save(op);
    const names=(await git(op.path,['remote'])).split('\n');
    if(names.includes(op.remoteName)){
      if(await git(op.path,['remote','get-url',op.remoteName])!==op.url)throw new AppError(409,'Remote locale cambiato: nessuna sovrascrittura');
    }else await git(op.path,['remote','add',op.remoteName,op.url]);
    op.step='remote_linked';this.save(op);
    if(await fingerprint(op.path)!==op.fingerprint)throw new AppError(409,'File cambiati durante il collegamento: push non eseguito');
    const ref=`refs/heads/${op.branch}`;
    const transport=['-c','credential.helper=','-c','credential.helper=!gh auth git-credential'];
    const observed=await this.executeGit(op.path,[...transport,'ls-remote',op.url,ref]);
    if(observed.split(/\s/)[0]!==op.head){
      if(observed.trim())throw new AppError(409,'Il branch remoto contiene già un altro commit: nessun force push');
      const account=await this.account();if(account.login!==op.owner||account.id!==op.accountId)throw new AppError(409,'Account GitHub cambiato prima del push');
      op.step='pushing';this.save(op);await this.executeGit(op.path,[...transport,'push','--porcelain',op.url,`${op.head}:${ref}`]);
    }
    const verified=await this.remote(op.owner,op.name);if(!verified)throw new AppError(409,'Repository non verificabile dopo il push');this.assertRemote(op,verified);
    if((await this.executeGit(op.path,[...transport,'ls-remote',op.url,ref])).split(/\s/)[0]!==op.head)throw new AppError(409,'Push senza conferma del commit remoto');
    this.store.db.prepare('UPDATE repositories SET remote=? WHERE id=?').run(`https://github.com/${op.owner}/${op.name}`,op.repositoryId);
    op.step='verified';op.state='completed';this.save(op);
  }
  async wait(id:string){await this.jobs.get(id);return this.get(id);}
  async shutdown(){await Promise.allSettled([...this.jobs.values()]);}
}
