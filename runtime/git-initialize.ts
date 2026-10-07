import {createHash} from 'node:crypto';
import {mkdir,readdir,lstat,readFile,writeFile,realpath,readlink} from 'node:fs/promises';
import {join,relative,resolve,isAbsolute,dirname} from 'node:path';
import {Store} from './storage.js';
import {AppError,now,redact} from './protocol.js';
import {git,repositoryIdentity} from './git.js';

type FileChoice={path:string;hash:string;size:number;mode:number;text?:string;link?:string};
type Scan={files:FileChoice[];excluded:{path:string;reason:string}[];ignored:string[];fingerprint:string};
export type Initialization=Scan&{id:string;projectId:string;repositoryId:string;path:string;identity:string;state:string;branch?:string;authorName?:string;authorEmail?:string;message?:string;selected?:string[];commit?:string;diff?:string;metadata?:{path:string;hash:string}[];hash?:string;error?:string};
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const secretName=(path:string)=>/(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|credentials\.json)$|\.(?:pem|p12|pfx|key)$/i.test(path);
const secretBytes=(bytes:Buffer)=>/-----BEGIN [\w ]*PRIVATE KEY-----|\b(?:sk-[\w-]{20,}|ghp_[\w]{20,}|github_pat_[\w]{20,})/.test(bytes.toString('utf8'));

/** Build a reviewable Git candidate in app storage, then install only its metadata after confirmation. */
export class GitInitializations {
  constructor(private store:Store){}
  get(id:string){const row=this.store.db.prepare("SELECT state,payload FROM repository_operations WHERE id=? AND kind='initialize'").get(id) as {state:string;payload:string}|undefined;
    if(!row)throw new AppError(404,'Preparazione Git non trovata');return{...JSON.parse(row.payload),state:row.state} as Initialization;}
  private save(op:Initialization){this.store.db.prepare('UPDATE repository_operations SET state=?,payload=?,updated_at=? WHERE id=?').run(op.state,JSON.stringify(op),now(),op.id);}
  private seed(id:string){return join(this.store.directory,'initializations',id,'candidate');}
  private args(op:Initialization,args:string[]){return['--git-dir='+join(this.seed(op.id),'.git'),'--work-tree='+op.path,...args];}
  private async inspect(op:Initialization,seed=this.seed(op.id)):Promise<Scan>{
    const args=['--git-dir='+join(seed,'.git'),'--work-tree='+op.path];
    const paths=(await git(op.path,[...args,'ls-files','--others','--exclude-standard','-z'])).split('\0').filter(Boolean).sort();
    if(paths.length>2000)throw new AppError(413,'Selezione iniziale troppo grande: configura prima .gitignore');
    const files:FileChoice[]=[];const excluded:{path:string;reason:string}[]=[];let textBudget=256000;
    for(const path of paths){
      if(secretName(path)){excluded.push({path,reason:'Nome sensibile'});continue;}
      const absolute=resolve(op.path,path);const delta=relative(op.path,absolute);
      if(!delta||delta.startsWith('..')||isAbsolute(delta)||path.split('/').includes('.git'))throw new AppError(400,'Percorso Git non sicuro');
      const stat=await lstat(absolute);
      if(stat.isSymbolicLink()){
        const target=await readlink(absolute);const linked=relative(op.path,resolve(dirname(absolute),target));
        if(isAbsolute(target)||linked.startsWith('..')||isAbsolute(linked)){excluded.push({path,reason:'Link esterno alla cartella'});continue;}
        files.push({path,hash:hash(target),size:Buffer.byteLength(target),mode:stat.mode&0o777,link:target});continue;
      }
      if(!stat.isFile()){excluded.push({path,reason:'Directory o repository annidato'});continue;}
      if(relative(op.path,await realpath(absolute)).startsWith('..')){excluded.push({path,reason:'Percorso esterno alla cartella'});continue;}
      if(stat.size>10*1024*1024){excluded.push({path,reason:'File oltre 10 MiB: aggiungilo esplicitamente dopo l’inizializzazione'});continue;}
      const bytes=await readFile(absolute);
      if(secretBytes(bytes)){excluded.push({path,reason:'Formato di segreto riconosciuto'});continue;}
      const text=bytes.includes(0)?undefined:bytes.toString('utf8').slice(0,Math.min(12000,textBudget));textBudget-=text?.length??0;
      files.push({path,hash:hash(bytes),size:bytes.length,mode:stat.mode&0o777,text});
    }
    const ignored=(await git(op.path,[...args,'ls-files','--others','--ignored','--exclude-standard','-z'])).split('\0').filter(Boolean).sort();
    const fingerprint=hash(JSON.stringify({identity:await repositoryIdentity(op.path,null),files:files.map(({text:_text,...file})=>file),excluded,ignored}));
    return{files,excluded,ignored,fingerprint};
  }
  async scan(projectId:string,repositoryId:string,id:string){
    this.store.project(projectId);
    if(this.store.db.prepare('SELECT 1 FROM repository_operations WHERE id=?').get(id)){const old=this.get(id);if(old.projectId!==projectId||old.repositoryId!==repositoryId)throw new AppError(409,'Preparazione riutilizzata');return old;}
    const repo=this.store.db.prepare('SELECT * FROM repositories WHERE id=? AND project_id=?').get(repositoryId,projectId) as {path:string;git_root:string|null}|undefined;
    if(!repo||repo.git_root)throw new AppError(400,'Seleziona una cartella del progetto senza Git');
    const path=await realpath(repo.path);
    let gitPresent=false;try{await git(path,['rev-parse','--show-toplevel']);gitPresent=true;}catch{}
    if(gitPresent)throw new AppError(409,'Git è stato inizializzato esternamente: aggiungi nuovamente la cartella per aggiornarne lo stato');
    try{await lstat(join(path,'.git'));throw new AppError(409,'La cartella .git esiste già');}catch(error:any){if(error.code!=='ENOENT')throw error;}
    const seed=this.seed(id);await mkdir(seed,{recursive:true,mode:0o700});await git(seed,['init','--template=','--initial-branch=main']);
    let op:Initialization={id,projectId,repositoryId,path,identity:JSON.stringify(await repositoryIdentity(path,null)),state:'selection',files:[],excluded:[],ignored:[],fingerprint:''};
    op={...op,...await this.inspect(op)};
    if(JSON.stringify(op).length>2*1024*1024)throw new AppError(413,'Anteprima troppo grande');
    this.store.db.prepare('INSERT INTO repository_operations VALUES(?,?,?,?,?,?,?,?)').run(id,projectId,repositoryId,'initialize',op.state,JSON.stringify(op),now(),now());
    return op;
  }
  async preview(id:string,paths:string[],message:string,authorName:string,authorEmail:string,branch:string){
    const op=this.get(id);if(op.state!=='selection')throw new AppError(409,'Prepara una nuova selezione per cambiare la proposta');
    const selected=[...new Set(paths)].sort();
    if(!selected.length||selected.some(path=>!op.files.some(f=>f.path===path)))throw new AppError(400,'Seleziona soltanto file disponibili nell’anteprima');
    if(/[\r\n<>]/.test(authorName)||!authorName.trim()||!/^[^\s<>@]+@[^\s<>@]+$/.test(authorEmail))throw new AppError(400,'Identità autore non valida');
    await git(op.path,['check-ref-format',`refs/heads/${branch}`]);
    if((await this.inspect(op)).fingerprint!==op.fingerprint)throw new AppError(409,'File cambiati dopo la selezione: ripeti la scansione');
    const attrs=(await git(op.path,this.args(op,['check-attr','filter','--',...selected]))).split('\n');
    if(attrs.some(line=>!line.endsWith(': unspecified')&&!line.endsWith(': unset')))throw new AppError(409,'Filtri Git personalizzati o LFS: inizializzazione assistita non supportata');
    await git(op.path,this.args(op,['symbolic-ref','HEAD',`refs/heads/${branch}`]));
    await git(op.path,this.args(op,['read-tree','--empty']));
    await git(op.path,this.args(op,['add','--',...selected]));
    if((await this.inspectSelected(op)).some(f=>!selected.includes(f)))throw new AppError(409,'Indice candidato fuori selezione');
    // Local author settings live only in this candidate and in the repository explicitly confirmed.
    await git(this.seed(id),['config','user.name',authorName]);await git(this.seed(id),['config','user.email',authorEmail]);
    const diff=await git(op.path,this.args(op,['diff','--cached','--no-ext-diff','--no-textconv','--']));
    await git(op.path,['-c','commit.gpgsign=false',...this.args(op,['commit','-m',message])]);
    // The candidate index now tracks selected files, so scan using an empty temporary index below.
    if((await this.inspectAll(op)).fingerprint!==op.fingerprint)throw new AppError(409,'File cambiati durante la preparazione del commit');
    op.selected=selected;op.message=message;op.authorName=authorName;op.authorEmail=authorEmail;op.branch=branch;
    op.commit=await git(this.seed(id),['rev-parse','HEAD']);op.diff=String(redact(diff)).slice(0,256000);op.metadata=await this.metadata(join(this.seed(id),'.git'));op.state='preview';op.hash=hash(JSON.stringify(op));this.save(op);return op;
  }
  private async inspectSelected(op:Initialization){return(await git(op.path,this.args(op,['ls-files','-z']))).split('\0').filter(Boolean);}
  private async inspectAll(op:Initialization){
    // Preserve the candidate's exact index while an independent empty repository enumerates the folder.
    const scanner=join(this.store.directory,'initializations',op.id,'scanner');await mkdir(scanner,{recursive:true});await git(scanner,['init','--template=']);
    return this.inspect(op,scanner);
  }
  private async metadata(root:string){
    const files:{path:string;hash:string}[]=[];
    const walk=async(folder:string)=>{for(const entry of await readdir(folder,{withFileTypes:true})){
      const path=join(folder,entry.name);
      if(entry.isDirectory())await walk(path);
      else if(entry.isFile())files.push({path:relative(root,path),hash:hash(await readFile(path))});
      else throw new AppError(409,'Metadati Git con link o file non regolari');
    }};
    await walk(root);return files.sort((a,b)=>a.path.localeCompare(b.path));
  }
  async confirm(id:string,approvedHash:string){
    const op=this.get(id);if(op.hash!==approvedHash)throw new AppError(409,'Anteprima non corrispondente');
    if(op.state==='completed')return op;
    if(!['preview','installing','unknown'].includes(op.state)||!op.commit)throw new AppError(409,'Preparazione Git non pronta');
    if(!op.metadata||JSON.stringify(await this.metadata(join(this.seed(id),'.git')))!==JSON.stringify(op.metadata))throw new AppError(409,'Metadati candidato cambiati: nessuna installazione');
    if(JSON.stringify(await repositoryIdentity(op.path,null))!==op.identity||(await this.inspectAll(op)).fingerprint!==op.fingerprint)throw new AppError(409,'Cartella o file cambiati: nessun metadato Git installato');
    const destination=join(op.path,'.git');
    try{
      if(op.state==='preview'){
        op.state='installing';this.save(op);
        await mkdir(destination,{mode:0o700});await writeFile(join(destination,'lagoto-initialization'),id,{flag:'wx',mode:0o600});
      }else if(!(await lstat(destination)).isDirectory()||(await readFile(join(destination,'lagoto-initialization'),'utf8'))!==id)throw new AppError(409,'Metadati Git senza prova di proprietà: nessuna sovrascrittura');
      const approved=new Map([...op.metadata.map(entry=>[entry.path,entry.hash] as const),['lagoto-initialization',hash(id)] as const]);
      for(const existing of await this.metadata(destination))if(approved.get(existing.path)!==existing.hash)throw new AppError(409,'Metadati Git esterni o modificati: nessuna sovrascrittura');
      const install=async(source:string,target:string)=>{
        for(const entry of await readdir(source,{withFileTypes:true})){
          const from=join(source,entry.name),to=join(target,entry.name);
          if(entry.isDirectory()){await mkdir(to,{recursive:true});if(!(await lstat(to)).isDirectory())throw new AppError(409,'Directory Git sostituita da un link');await install(from,to);}
          else if(entry.isFile()){
            const bytes=await readFile(from);
            try{await writeFile(to,bytes,{flag:'wx',mode:0o600});}catch(error:any){if(error.code!=='EEXIST'||!(await lstat(to)).isFile()||hash(await readFile(to))!==hash(bytes))throw new AppError(409,'Metadati Git cambiati durante il recupero: nessuna sovrascrittura');}
          }else throw new AppError(409,'Metadati candidato non regolari');
        }
      };
      await install(join(this.seed(id),'.git'),destination);
      if(await git(op.path,['rev-parse','HEAD'])!==op.commit)throw new AppError(409,'Commit installato non corrispondente');
      this.store.db.prepare('UPDATE repositories SET git_root=?,identity=? WHERE id=?').run(op.path,JSON.stringify(await repositoryIdentity(op.path,op.path)),op.repositoryId);
      op.state='completed';delete op.error;this.save(op);return op;
    }catch(error){op.state='unknown';op.error=String(redact(error instanceof Error?error.message:String(error)));this.save(op);throw error;}
  }
}
