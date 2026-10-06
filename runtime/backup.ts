import Database from 'better-sqlite3';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,copyFile,rename,access} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {Store} from './storage.js';
import {createCheckpoint,restoreCheckpoint,type Manifest} from './checkpoint.js';
import {AppError,identifier,now} from './protocol.js';

const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
type BackupManifest={version:1;createdAt:string;database:string;blobs:{hash:string;bytes:number}[]};
async function fresh(path:string){if(!isAbsolute(path))throw new AppError(400,'Destinazione assoluta richiesta');try{await access(path);}catch(e:any){if(e.code==='ENOENT')return;throw e;}throw new AppError(409,'La destinazione esiste già: scegli una nuova cartella');}
export async function createBackup(store:Store,destination:string){
  await fresh(destination);
  if(store.db.prepare("SELECT 1 FROM runs WHERE state IN ('starting','running','stopping','waiting_permission','unknown')").get() || store.db.prepare("SELECT 1 FROM verifications WHERE state IN ('running','unknown')").get())throw new AppError(409,'Arresta e riconcilia le esecuzioni prima del backup');
  if(store.db.prepare("SELECT 1 FROM repository_operations WHERE state IN ('starting','running','stopping','installing','unknown')").get())throw new AppError(409,'Completa o riconcilia le operazioni sui repository prima del backup');
  const tasks=store.db.prepare('SELECT DISTINCT task_id FROM task_repositories').all() as {task_id:string}[];
  for(const task of tasks)await createCheckpoint(store,task.task_id);
  const staging=destination+'.partial-'+randomUUID();await mkdir(staging,{mode:0o700});await mkdir(join(staging,'blobs'),{mode:0o700});
  await store.db.backup(join(staging,'lagoto.sqlite'));
  const db=new Database(join(staging,'lagoto.sqlite'),{readonly:true});
  const referenced=new Set<string>();
  try{for(const row of db.prepare('SELECT manifest FROM checkpoints').all() as {manifest:string}[]){const m=JSON.parse(row.manifest) as Manifest;for(const repo of m.repositories){referenced.add(repo.index);for(const file of repo.entries)if(file.hash)referenced.add(file.hash);for(const object of repo.objects??[])referenced.add(object.hash);}}}finally{db.close();}
  const blobs:BackupManifest['blobs']=[];
  for(const digest of [...referenced].sort()){
    if(!/^[a-f0-9]{64}$/.test(digest))throw new AppError(400,'Hash nel database non valido');
    const bytes=await readFile(join(store.directory,'blobs',digest));if(hash(bytes)!==digest)throw new AppError(500,'Artefatto corrotto: backup non completato');
    await writeFile(join(staging,'blobs',digest),bytes,{flag:'wx',mode:0o600});blobs.push({hash:digest,bytes:bytes.length});
  }
  const manifest:BackupManifest={version:1,createdAt:now(),database:hash(await readFile(join(staging,'lagoto.sqlite'))),blobs};
  await writeFile(join(staging,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
  await rename(staging,destination);return{destination,checkpoints:tasks.length,blobs:blobs.length,credentialsIncluded:false};
}
export async function restoreBackup(source:string,destination:string){
  await fresh(destination);
  const manifest=JSON.parse(await readFile(join(source,'manifest.json'),'utf8')) as BackupManifest;
  if(manifest.version!==1||!Array.isArray(manifest.blobs)||manifest.blobs.length>1000000)throw new AppError(400,'Manifest backup non supportato');
  if(hash(await readFile(join(source,'lagoto.sqlite')))!==manifest.database)throw new AppError(500,'Checksum database non valido');
  for(const blob of manifest.blobs){if(!/^[a-f0-9]{64}$/.test(blob.hash))throw new AppError(400,'Percorso artefatto non valido');const bytes=await readFile(join(source,'blobs',blob.hash));if(bytes.length!==blob.bytes||hash(bytes)!==blob.hash)throw new AppError(500,'Checksum artefatto non valido');}
  // Validate before creating the destination. Never overwrite the archive in use.
  const probe=new Database(join(source,'lagoto.sqlite'),{readonly:true});
  try{if(probe.pragma('integrity_check',{simple:true})!=='ok')throw new AppError(500,'Database corrotto');for(const row of probe.prepare('SELECT id FROM tasks').all() as {id:string}[])identifier.parse(row.id);}finally{probe.close();}
  await mkdir(destination,{mode:0o700});await mkdir(join(destination,'blobs'),{mode:0o700});await copyFile(join(source,'lagoto.sqlite'),join(destination,'lagoto.sqlite'));
  for(const blob of manifest.blobs)await copyFile(join(source,'blobs',blob.hash),join(destination,'blobs',blob.hash));
  const db=new Database(join(destination,'lagoto.sqlite'));db.exec('DELETE FROM runtime_owner');
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='process_leases'").get())db.exec('DELETE FROM process_leases');
  db.close(); // Process identities from a different environment can never authorize signals here.
  const restored=new Store(destination);
  try{
    // Recovery preserves history, not authorization to repeat effects against old paths/accounts.
    for(const row of restored.db.prepare("SELECT id,payload FROM repository_operations WHERE state<>'completed'").all() as {id:string;payload:string}[]){
      const payload={...JSON.parse(row.payload),state:'restored',error:'Archivio ripristinato: prepara una nuova anteprima nel nuovo ambiente'};
      restored.db.prepare("UPDATE repository_operations SET state='restored',payload=? WHERE id=?").run(JSON.stringify(payload),row.id);
    }
    for(const row of restored.db.prepare("SELECT id,payload FROM external_actions WHERE kind='delivery' AND state<>'delivered'").all() as {id:string;payload:string}[]){
      const payload={...JSON.parse(row.payload),state:'restored'};
      restored.db.prepare("UPDATE external_actions SET state='restored',payload=? WHERE id=?").run(JSON.stringify(payload),row.id);
    }
    restored.db.prepare("UPDATE handoffs SET state='cancelled',error='Nuovo ambiente: nuova anteprima richiesta' WHERE state NOT IN ('started','cancelled')").run();
    restored.db.prepare("UPDATE verifications SET state='stale' WHERE state='passed'").run();
    const tasks=restored.db.prepare('SELECT DISTINCT task_id FROM task_repositories').all() as {task_id:string}[];
    await mkdir(join(destination,'worktrees'),{mode:0o700});
    for(const task of tasks){
      const checkpoint=restored.db.prepare('SELECT id FROM checkpoints WHERE task_id=? ORDER BY created_at DESC,id DESC LIMIT 1').get(task.task_id) as {id:string}|undefined;
      if(!checkpoint)throw new AppError(409,'Task senza checkpoint recuperabile');
      const result=await restoreCheckpoint(restored,checkpoint.id,join(destination,'worktrees',task.task_id));
      if(!result.gitRestored)throw new AppError(409,'Il backup storico contiene solo un export: ripristino Git non disponibile');
      for(const repo of result.manifest.repositories)restored.db.prepare('UPDATE task_repositories SET path=? WHERE task_id=? AND repository_id=?').run(join(destination,'worktrees',task.task_id,repo.repositoryId),task.task_id,repo.repositoryId);
    }
    restored.db.prepare('UPDATE profiles SET capabilities=?').run(JSON.stringify({modes:[],efforts:[],verification:'unverified',reason:'Nuovo ambiente: ripetere la verifica'}));
    return{destination:resolve(destination),tasks:tasks.length,credentialsIncluded:false,needsProfileVerification:true};
  }finally{restored.close();}
}
