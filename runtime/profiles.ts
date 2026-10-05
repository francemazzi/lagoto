import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { Store } from './storage.js';
import { startAdapter, type Profile } from './adapters.js';
import { AppError, now, redact } from './protocol.js';
import { inventory } from './integrations.js';
import {runtimeIdentity} from './runtime-identity.js';

export class ProfileVerifier {
  private active = new Map<string,Promise<void>>();
  private running=new Map<string,Awaited<ReturnType<typeof startAdapter>>>();
  private cancelled=new Set<string>();
  constructor(private store: Store, private notify: (event:unknown)=>void,private adapterFactory=startAdapter,private identityFactory=runtimeIdentity) {}
  start(profileId: string, secret?: string) {
    const profile = this.store.db.prepare('SELECT * FROM profiles WHERE id=?').get(profileId) as Profile|undefined;
    if (!profile) throw new AppError(404,'Profilo non trovato');
    if(this.store.db.prepare("SELECT 1 FROM runs WHERE profile_id=? AND state IN ('starting','running','stopping','waiting_permission','unknown')").get(profileId))throw new AppError(409,'Arresta la run prima di riverificare il profilo');
    if (this.active.has(profileId)) throw new AppError(409,'Verifica già in corso');
    this.cancelled.delete(profileId);
    const id = randomUUID();
    this.store.db.prepare('INSERT INTO profile_checks(id,profile_id,state,created_at) VALUES(?,?,?,?)').run(id,profileId,'checking',now());
    this.store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run(JSON.stringify({modes:[],efforts:[],verification:'checking'}),profileId);
    const work = this.verify(profile,id,secret).catch(error=>{
      const detail={message:String(redact(error instanceof Error?error.message:String(error)))};
      this.store.db.prepare("UPDATE profile_checks SET state='failed',detail=? WHERE id=?").run(JSON.stringify(detail),id);
      this.store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run(JSON.stringify({modes:[],efforts:[],verification:'failed',proof:detail}),profileId);
    }).finally(()=>{this.active.delete(profileId);this.running.delete(profileId);this.cancelled.delete(profileId);});
    this.active.set(profileId,work); return {id,state:'checking'};
  }
  private async verify(profile: Profile, id:string, secret?:string) {
    let adapter: Awaited<ReturnType<typeof startAdapter>>|undefined; let failure: unknown; let timer: NodeJS.Timeout|undefined;
    const directory = join(this.store.directory,'profile-probes'); await mkdir(directory,{recursive:true,mode:0o700});
    const root = await mkdtemp(join(directory,'probe-'));
    const nonce = randomUUID()+'\n'; await writeFile(join(root,'input.txt'),nonce);
    const identity=await this.identityFactory(profile);
    let toolObserved = false, textObserved = false; const events:Record<string,number>={};const permissions:string[]=[];
    const diagnostic:unknown[]=[];
    try {
      if(this.cancelled.has(profile.id))throw new AppError(499,'Verifica interrotta');
      adapter = await this.adapterFactory({profile,cwd:root,directories:[root],home:join(this.store.directory,'profiles',profile.id),mode:'agent',secret,
        prompt:'Compatibility test in a synthetic directory. Read input.txt and copy its exact bytes into output.txt using your file edit tool. The input is one line terminated by a single LF newline: preserve that final newline in output.txt. A read-only shell command to read input.txt is allowed if your runtime requires it. Do not access the network, delegate, run other commands or edit any other file. Then reply with a short confirmation.',
        permission: async tool => {permissions.push(tool);return /read|write|edit|fileChange\/requestApproval|list|glob/i.test(tool) && !/command|shell|bash|exec/i.test(tool);},
        onEvent:event=>{events[event.kind]=(events[event.kind]??0)+1;if(event.kind==='tool')toolObserved=true;if(['text','text_snapshot'].includes(event.kind) && event.text)textObserved=true;
          if(['tool','error','result','text_snapshot'].includes(event.kind))diagnostic.push(redact(event));},
      });
      this.running.set(profile.id,adapter);if(this.cancelled.has(profile.id)){await adapter.stop();throw new AppError(499,'Verifica interrotta');}
      await Promise.race([adapter.completion,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new AppError(504,'Verifica modello scaduta')),120000);})]);
      if(await readFile(join(root,'output.txt'),'utf8')!==nonce || !toolObserved || !textObserved) throw new AppError(409,'La prova non ha confermato file, strumenti e streaming');
      if(profile.provider==='cursor') {
        await adapter.stop(); clearTimeout(timer);
        const outside=join(directory,`denied-${id}.txt`);let denials=0;
        if(this.cancelled.has(profile.id))throw new AppError(499,'Verifica interrotta');
        adapter=await this.adapterFactory({profile,cwd:root,directories:[root],home:join(this.store.directory,'profiles',profile.id),mode:'agent',
          prompt:`Synthetic permission test. Use ONLY the shell/terminal command tool to execute: printf DENIED_TEST > ${outside}. If denied, stop and reply DENIED without another tool or workaround.`,
          permission:async()=>{denials++;return false;},onEvent:()=>{}});
        this.running.set(profile.id,adapter);if(this.cancelled.has(profile.id)){await adapter.stop();throw new AppError(499,'Verifica interrotta');}
        await Promise.race([adapter.completion,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new AppError(504,'Rifiuto permesso non verificato')),90000);})]);
        let exists=true;try{await access(outside);}catch(error:any){if(error.code==='ENOENT')exists=false;else throw error;}
        if(exists||!denials)throw new AppError(409,'Il rifiuto del comando ACP non è stato applicato');
      }
    } catch(error) { failure=error; }
    finally { clearTimeout(timer); try { await adapter?.stop(); } catch(error) { failure=error; } }
    const versions = await inventory();
    if(this.cancelled.has(profile.id))failure=new AppError(499,'Verifica interrotta');
    if(JSON.stringify(identity)!==JSON.stringify(await this.identityFactory(profile)))failure=new AppError(409,'Runtime cambiato durante la verifica');
    const detail = {verifiedAt:now(),model:profile.model,endpoint:profile.endpoint,versions,identity,events,permissions,scope:profile.provider==='cursor'?'read-write-stream-stop-command-permission-macos-write-scope':'read-write-stream-stop',
      diagnostic:failure?diagnostic.slice(-12):[],
      message:failure ? String(redact(failure instanceof Error ? failure.message : String(failure))) : 'Lettura, modifica, streaming e arresto verificati su fixture'};
    const state = failure?'failed':'passed';
    this.store.db.transaction(()=>{
      this.store.db.prepare('UPDATE profile_checks SET state=?,detail=? WHERE id=?').run(state,JSON.stringify(detail),id);
      this.store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run(JSON.stringify({modes:failure?[]:['agent'],efforts:[],verification:state,proof:detail}),profile.id);
    })();
    this.notify({kind:'profile_check',profileId:profile.id,state});
  }
  async cancel(profileId:string){const work=this.active.get(profileId);if(!work)throw new AppError(409,'Nessuna verifica in corso');this.cancelled.add(profileId);let failure:unknown;
    try{await this.running.get(profileId)?.stop();}catch(error){failure=error;}finally{await work;}
    if(failure)throw failure;return{stopped:true};}
  async shutdown(){await Promise.allSettled([...this.active.keys()].map(id=>this.cancel(id)));}
}
