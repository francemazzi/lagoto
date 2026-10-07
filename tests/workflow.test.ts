import {afterEach,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,chmodSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {Store} from '../runtime/storage.js';
import {Service} from '../runtime/service.js';
import {git,prepareWorktrees} from '../runtime/git.js';
import {createCheckpoint,restoreCheckpoint,fingerprint} from '../runtime/checkpoint.js';
import {RunManager} from '../runtime/runs.js';
import {Handoffs} from '../runtime/handoff.js';
import {claudeNormalizer} from '../runtime/adapters.js';
import {transcript} from '../runtime/transcript.js';
import {createBackup,restoreBackup} from '../runtime/backup.js';
import {Deliveries} from '../runtime/delivery.js';
import {ProfileVerifier} from '../runtime/profiles.js';

const dirs:string[]=[];const stores:Store[]=[];
const temp=()=>{const path=mkdtempSync(join(tmpdir(),'lagoto-flow-'));dirs.push(path);return path;};
const call=(s:Service,method:string,params:Record<string,unknown>={})=>s.handle({jsonrpc:'2.0',id:'fixture',method,params}) as Promise<any>;
async function fixture(count=1){
  const store=new Store(temp());stores.push(store);const service=new Service(store);
  const project=await call(service,'project/create',{name:'Synthetic three-repository contract'});
  const repos=[];
  for(let i=0;i<count;i++){
    const path=temp();await git(path,['init']);await git(path,['config','user.name','Lagoto Test']);await git(path,['config','user.email','test@example.invalid']);
    writeFileSync(join(path,'contract.json'),'{"version":1}\n');writeFileSync(join(path,'deleted.txt'),'remove me');
    await git(path,['add','.']);await git(path,['commit','-m','fixture']);repos.push(await call(service,'repository/add',{projectId:project.id,path}));
  }
  const task=await call(service,'task/create',{projectId:project.id,title:'Update shared contract',objective:'Keep backend, frontend and desktop compatible'});
  const worktrees=await call(service,'task/prepare',{taskId:task.id,repositoryIds:repos.map(r=>r.id)});
  return {store,service,project,task,worktrees};
}
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const p of dirs.splice(0))rmSync(p,{recursive:true,force:true});});

it('P07-I01 restores three complete Git repositories with byte-identical index, staged/unstaged changes, binary, deletion and symlink',async()=>{
  const {store,task,worktrees}=await fixture(3);const indices:Buffer[]=[];const states:string[]=[];
  for(const work of worktrees){
    writeFileSync(join(work.path,'contract.json'),'{"version":2}\n');await git(work.path,['add','contract.json']);
    writeFileSync(join(work.path,'contract.json'),'{"version":3}\n');writeFileSync(join(work.path,'binary.bin'),Buffer.from([0,255,254,10]));
    writeFileSync(join(work.path,'run.sh'),'#!/bin/sh\nexit 0\n');chmodSync(join(work.path,'run.sh'),0o755);await git(work.path,['add','binary.bin','run.sh']);
    rmSync(join(work.path,'deleted.txt'));symlinkSync('contract.json',join(work.path,'contract-link'));
    states.push(await git(work.path,['status','--porcelain=v1','-z']));indices.push(readFileSync(await git(work.path,['rev-parse','--path-format=absolute','--git-path','index'])));
  }
  const saved=await createCheckpoint(store,task.id);const destination=join(temp(),'restored');
  expect((await restoreCheckpoint(store,saved.id,destination)).gitRestored).toBe(true);
  for(let i=0;i<worktrees.length;i++){
    const restored=join(destination,worktrees[i].repository_id);
    expect(readFileSync(join(restored,'.git/index'))).toEqual(indices[i]);
    expect(await git(restored,['status','--porcelain=v1','-z'])).toBe(states[i]);
    expect(await git(restored,['show',':contract.json'])).toBe('{"version":2}');
    expect(readFileSync(join(restored,'contract.json'),'utf8')).toBe('{"version":3}\n');
    expect(await git(restored,['fsck','--no-reflogs'])).toBe('');
    expect(existsSync(join(restored,'deleted.txt'))).toBe(false);
  }
});

it('P07-I01 does not hide a credential from Git history in an otherwise sanitized checkpoint',async()=>{
  const {store,task,worktrees}=await fixture();const path=worktrees[0].path;
  writeFileSync(join(path,'.env'),'SYNTHETIC=private');await git(path,['add','.env']);
  await expect(createCheckpoint(store,task.id)).rejects.toThrow('sensibile');
  expect(store.db.prepare('SELECT COUNT(*) AS count FROM checkpoints').get()).toEqual({count:0});
});

it('P07-I06 detects staging-only edits even when worktree bytes and porcelain states match',async()=>{
  const {worktrees}=await fixture();const path=worktrees[0].path;
  writeFileSync(join(path,'contract.json'),'staged A');await git(path,['add','contract.json']);writeFileSync(join(path,'contract.json'),'working');const before=await fingerprint(path);
  writeFileSync(join(path,'contract.json'),'staged B');await git(path,['add','contract.json']);writeFileSync(join(path,'contract.json'),'working');
  expect(await fingerprint(path)).not.toBe(before);
});

it('P08-I01 preserves the task and worktrees and creates one successor on duplicate confirmation',async()=>{
  const {store,service,task,worktrees}=await fixture(3);
  const profile=await call(service,'profile/create',{name:'Declared fake',provider:'codex',model:'synthetic-only'});
  store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run(JSON.stringify({modes:['agent']}),profile.id);
  let launches=0,received='';
  const runs=new RunManager(store,()=>{},async options=>{launches++;received=options.prompt;return{sessionId:'fixture',completion:Promise.resolve(),stop:async()=>{}};});
  const h=new Handoffs(store,runs);const id=crypto.randomUUID();
  const preview:any=await h.prepare(task.id,profile.id,id);expect(preview.state).toBe('preview');
  const [a,b]=await Promise.all([h.confirm(id,preview.context_hash,'Continue contract update','agent'),h.confirm(id,preview.context_hash,'Continue contract update','agent')]) as any[];
  await runs.shutdown();expect(a.id).toBe(b.id);expect(launches).toBe(1);
  expect(received).toContain('Keep backend, frontend and desktop compatible');
  for(const work of worktrees)expect(received).toContain(work.path);
  expect(store.db.prepare('SELECT count(*) AS count FROM tasks').get()).toEqual({count:1});
  expect(store.db.prepare('SELECT count(*) AS count FROM task_repositories').get()).toEqual({count:3});
  await expect(h.confirm(id,preview.context_hash,'Different request','agent')).rejects.toThrow('contenuti diversi');
  // A crash can leave the durable successor without the final handoff transition.
  store.db.prepare("UPDATE handoffs SET state='starting',successor_id=NULL WHERE id=?").run(id);
  const recovered:any=await new Handoffs(store,runs).prepare(task.id,profile.id,id);expect(recovered.state).toBe('started');expect(recovered.successor_id).toBe(a.id);expect(launches).toBe(1);
});

it('P08-I03 invalidates a handoff preview when files changed before confirmation',async()=>{
  const {store,service,task,worktrees}=await fixture();const p=await call(service,'profile/create',{name:'Fake',provider:'codex',model:'fixture'});
  store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run('{"modes":["agent"]}',p.id);
  const h=new Handoffs(store,new RunManager(store,()=>{}));const id=crypto.randomUUID();const preview:any=await h.prepare(task.id,p.id,id);
  writeFileSync(join(worktrees[0].path,'contract.json'),'external change');
  await expect(h.confirm(id,preview.context_hash,'Continue','agent')).rejects.toThrow('cambiati');
  expect(store.db.prepare('SELECT count(*) AS count FROM runs').get()).toEqual({count:0});
});

it('P05-I02 renders multiple provider messages, tool results and the final once while preserving raw events',async()=>{
  const {store,service,task}=await fixture();const p=await call(service,'profile/create',{name:'Replay',provider:'claude',model:'fixture'});const run=crypto.randomUUID();
  store.db.prepare('INSERT INTO runs(id,task_id,profile_id,state,model,created_at) VALUES(?,?,?,?,?,?)').run(run,task.id,p.id,'finished','fixture',new Date().toISOString());
  const normalize=claudeNormalizer();
  const native=[{type:'stream_event',event:{type:'message_start',message:{id:'m1'}}},{type:'stream_event',event:{type:'content_block_delta',index:0,delta:{text:'Prima'}}},
    {type:'assistant',message:{id:'m1',content:[{type:'text',text:'Prima'},{type:'tool_use',id:'t1',name:'Read',input:{file_path:'fixture.txt'}}]}},
    {type:'stream_event',event:{type:'message_start',message:{id:'m2'}}},{type:'stream_event',event:{type:'content_block_delta',index:0,delta:{text:'Finale 🐕'}}},
    {type:'assistant',message:{id:'m2',content:[{type:'text',text:'Finale 🐕'}]}},{type:'result',result:'Finale 🐕',is_error:false}];
  for(const source of native)for(const event of normalize(source))store.event(task.id,run,event.kind,event);
  const view=transcript(store.db,task.id).blocks as any[];
  expect(view.filter(b=>b.kind==='text').map(b=>b.text)).toEqual(['Prima','Finale 🐕']);expect(view.filter(b=>b.kind==='tool')).toHaveLength(1);
  expect(store.events(task.id).filter((e:any)=>e.kind==='raw')).toHaveLength(native.length);
});

it('P11-I05 restores database and Git artifacts after original clones disappear, rejecting corrupt backup before destination writes',async()=>{
  const {store,task,worktrees}=await fixture(3);
  for(const work of worktrees){writeFileSync(join(work.path,'contract.json'),'{"version":2}\n');await git(work.path,['add','contract.json']);writeFileSync(join(work.path,'contract.json'),'{"version":3}\n');}
  const backup=join(temp(),'backup');await createBackup(store,backup);
  for(const work of worktrees)rmSync(dirname(await git(work.path,['rev-parse','--path-format=absolute','--git-common-dir'])),{recursive:true,force:true});
  const destination=join(temp(),'restored');expect((await restoreBackup(backup,destination)).tasks).toBe(1);
  const restored=new Store(destination);stores.push(restored);
  expect(restored.task(task.id).objective).toContain('compatible');
  for(const work of restored.db.prepare('SELECT path FROM task_repositories').all() as {path:string}[]){expect(await git(work.path,['show',':contract.json'])).toBe('{"version":2}');expect(readFileSync(join(work.path,'contract.json'),'utf8')).toBe('{"version":3}\n');}
  const manifest=JSON.parse(readFileSync(join(backup,'manifest.json'),'utf8'));writeFileSync(join(backup,'blobs',manifest.blobs[0].hash),'CORRUPT');
  const invalid=join(temp(),'invalid');await expect(restoreBackup(backup,invalid)).rejects.toThrow('Checksum');expect(existsSync(invalid)).toBe(false);
},30000);

it('P11-I05 restore invalidates pending external authorizations and verification validity without replaying old effects',async()=>{
  const {store,service,project,task,worktrees}=await fixture();const work=worktrees[0];
  writeFileSync(join(work.path,'contract.json'),'{"version":2}\n');
  await call(service,'verification/start',{taskId:task.id,repositoryId:work.repository_id,command:'test -f contract.json'});
  let checks=await service.verifications.list(task.id);
  for(let attempt=0;attempt<100&&checks[0]!.state==='running';attempt++){await new Promise(r=>setTimeout(r,20));checks=await service.verifications.list(task.id);}
  expect(checks[0]!.state).toBe('passed');
  const delivery=await service.deliveries.preview(task.id,crypto.randomUUID(),'Preview before backup',[{repositoryId:work.repository_id,paths:['contract.json']}]);
  const linkId=crypto.randomUUID();const hash='a'.repeat(64);
  store.db.prepare('INSERT INTO repository_operations VALUES(?,?,?,?,?,?,?,?)').run(linkId,project.id,work.repository_id,'github-link','preview',JSON.stringify({id:linkId,state:'preview',hash,path:work.path}),new Date().toISOString(),new Date().toISOString());
  const backup=join(temp(),'pending-backup');await createBackup(store,backup);
  const target=join(temp(),'restored');await restoreBackup(backup,target);const recovered=new Store(target);stores.push(recovered);const s=new Service(recovered);
  await expect(s.deliveries.confirm(delivery.id,delivery.hash)).rejects.toThrow('ripristinato');
  expect(()=>s.github.confirm(linkId,hash)).toThrow('ripristinato');
  expect((await s.verifications.list(task.id))[0]!.state).toBe('stale');
  expect(await git(work.path,['rev-list','--count','HEAD'])).toBe('1');expect(await git(work.path,['status','--short'])).toContain('contract.json');
  store.db.prepare("UPDATE repository_operations SET state='running' WHERE id=?").run(linkId);
  await expect(createBackup(store,join(temp(),'must-not-backup-active'))).rejects.toThrow('operazioni sui repository');
});

it('P11-I03 GH-10 retries a failed second push across three real remotes without duplicate commits or losing unrelated staging',async()=>{
  const {store,task,worktrees}=await fixture(3);const selections=[];const staging:string[]=[];
  for(const work of worktrees){
    const bare=temp();await git(bare,['init','--bare']);await git(work.path,['remote','add','delivery-fixture',bare]);
    writeFileSync(join(work.path,'contract.json'),'{"version":2}\n');writeFileSync(join(work.path,'new.txt'),'selected new file\n');
    writeFileSync(join(work.path,'unrelated.txt'),'preserve staged bytes\n');await git(work.path,['add','unrelated.txt']);writeFileSync(join(work.path,'unrelated.txt'),'preserve unstaged bytes\n');
    staging.push(await git(work.path,['show',':unrelated.txt']));selections.push({repositoryId:work.repository_id,paths:['contract.json','new.txt'],remote:'delivery-fixture'});
  }
  let fail=true;const d=new Deliveries(store,async(path,args)=>{if(fail&&path===worktrees[1].path&&args[0]==='push'){fail=false;throw new Error('Injected second remote outage');}return git(path,args);});
  const preview=await d.preview(task.id,crypto.randomUUID(),'Update contract',selections);
  const first=await d.confirm(preview.id,preview.hash);expect(first.state).toBe('failed');expect(first.items[0]!.state).toBe('delivered');expect(first.items[1]!.commit).toBeTruthy();
  const commits=first.items.map(i=>i.commit);const completed=await d.confirm(preview.id,preview.hash);expect(completed.state).toBe('delivered');expect(completed.items[0]!.commit).toBe(commits[0]);expect(completed.items[1]!.commit).toBe(commits[1]);
  expect((await d.confirm(preview.id,preview.hash)).items.map(i=>i.commit)).toEqual(completed.items.map(i=>i.commit));
  for(let i=0;i<worktrees.length;i++){const work=worktrees[i];expect(await git(work.path,['show',':unrelated.txt'])).toBe(staging[i]);expect(readFileSync(join(work.path,'unrelated.txt'),'utf8')).toBe('preserve unstaged bytes\n');expect(await git(work.path,['rev-list','--count','HEAD'])).toBe('2');expect(await git(work.path,['show','HEAD:new.txt'])).toBe('selected new file');}
},30000);

it('P04-I01 resumes preparation after failure on the third repository without changing original bytes or indexes',async()=>{
  const {store,service,project}=await fixture(3);
  const repos=await call(service,'repository/list',{projectId:project.id});const before=await Promise.all(repos.map(async(r:any)=>({bytes:readFileSync(join(r.path,'contract.json')),index:readFileSync(await git(r.path,['rev-parse','--path-format=absolute','--git-path','index']))})));
  const task=await call(service,'task/create',{projectId:project.id,title:'Resume preparation',objective:'Synthetic isolation'});let calls=0;
  await expect(prepareWorktrees(store,task.id,repos.map((r:any)=>r.id),async(path,args)=>{if(args[0]==='worktree'&&++calls===3)throw new Error('Third repository unavailable');return git(path,args);})).rejects.toThrow('Third');
  expect(store.db.prepare('SELECT count(*) AS count FROM task_repositories WHERE task_id=?').get(task.id)).toEqual({count:0});
  expect(await prepareWorktrees(store,task.id,repos.map((r:any)=>r.id))).toHaveLength(3);
  for(let i=0;i<repos.length;i++){expect(readFileSync(join(repos[i].path,'contract.json'))).toEqual(before[i].bytes);expect(readFileSync(await git(repos[i].path,['rev-parse','--path-format=absolute','--git-path','index']))).toEqual(before[i].index);}
});

it('P05-I01 retains queued input on a rejected start and delivers it atomically once',async()=>{
  const {store,service,task}=await fixture();const profile=await call(service,'profile/create',{name:'Fake',provider:'codex',model:'fixture'});
  const queued=await call(service,'task/queue',{taskId:task.id,id:crypto.randomUUID(),text:'Queued request'});
  const runs=new RunManager(store,()=>{},async()=>({sessionId:'fixture',completion:Promise.resolve(),stop:async()=>{}}));
  const request=crypto.randomUUID();await expect(runs.start(task.id,profile.id,'Queued request',request,'agent',undefined,undefined,undefined,undefined,queued.id)).rejects.toThrow('Modalità');
  expect((await call(service,'task/snapshot',{taskId:task.id})).queued).toHaveLength(1);
  store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run('{"modes":["agent"]}',profile.id);
  const a:any=await runs.start(task.id,profile.id,'Queued request',request,'agent',undefined,undefined,undefined,undefined,queued.id);const b:any=await runs.start(task.id,profile.id,'Queued request',request,'agent',undefined,undefined,undefined,undefined,queued.id);
  await runs.shutdown();expect(a.id).toBe(b.id);expect((await call(service,'task/snapshot',{taskId:task.id})).queued).toHaveLength(0);
});

it('P08-I02 stops an actual verification process before handoff and preserves an explicitly interrupted result',async()=>{
  const {store,service,task,worktrees}=await fixture();const profile=await call(service,'profile/create',{name:'Fake',provider:'codex',model:'fixture'});store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run('{"modes":["agent"]}',profile.id);
  await call(service,'verification/start',{taskId:task.id,repositoryId:worktrees[0].repository_id,command:'sleep 30'});
  await expect(call(service,'checkpoint/create',{taskId:task.id})).rejects.toThrow('verifica');
  const preview:any=await service.handoffs.prepare(task.id,profile.id,crypto.randomUUID());expect(preview.state).toBe('preview');
  const rows=await service.verifications.list(task.id);expect(rows[0]!.state).toBe('interrupted');expect(preview.context).toContain('interrupted');
});

it('P07-I06 HAND-07 a successful verification becomes stale after external file changes',async()=>{
  const {service,task,worktrees}=await fixture();await call(service,'verification/start',{taskId:task.id,repositoryId:worktrees[0].repository_id,command:'test -f contract.json'});
  let rows:any[]=[];for(let i=0;i<100;i++){rows=await service.verifications.list(task.id);if(rows[0].state!=='running')break;await new Promise(r=>setTimeout(r,20));}
  expect(rows[0]!.state).toBe('passed');writeFileSync(join(worktrees[0].path,'contract.json'),'changed');expect((await service.verifications.list(task.id))[0]!.state).toBe('stale');
});

it('P03-I04/P07-I04 versions criteria and decisions and reopens completed work when its proof becomes stale',async()=>{
  const {service,task,worktrees}=await fixture();
  await expect(call(service,'task/complete',{taskId:task.id})).rejects.toThrow('criteri');
  const criterion=await call(service,'criterion/edit',{taskId:task.id,content:'Contract exists',reason:'Initial acceptance'});
  const test=await call(service,'verification/start',{taskId:task.id,repositoryId:worktrees[0].repository_id,command:'test -f contract.json'});
  for(let i=0;i<100;i++){if((await service.verifications.list(task.id))[0]!.state!=='running')break;await new Promise(r=>setTimeout(r,20));}
  await call(service,'criterion/accept',{taskId:task.id,id:criterion.id,revision:1,verificationId:test.id});expect(await call(service,'task/complete',{taskId:task.id})).toEqual({status:'completed'});
  writeFileSync(join(worktrees[0].path,'contract.json'),'changed');const stale=await call(service,'task/progress',{taskId:task.id});expect(stale.status).toBe('ready');expect(stale.criteria[0].state).toBe('stale');
  await call(service,'criterion/edit',{taskId:task.id,id:criterion.id,revision:1,content:'New acceptance',reason:'Scope changed'});
  await expect(call(service,'criterion/accept',{taskId:task.id,id:criterion.id,revision:1,verificationId:test.id})).rejects.toThrow('revisione');
  const first=await call(service,'decision/save',{taskId:task.id,content:'Obsolete decision'});await call(service,'decision/save',{taskId:task.id,content:'Current decision',supersedes:first.id});
  const pack=await call(service,'context/preview',{taskId:task.id});expect(pack.content).toContain('Current decision');expect(pack.content).not.toContain('Obsolete decision');expect(pack.content).toContain('user-confirmed');
});

it('P01-I03 stops a pending profile probe on shutdown instead of consuming quota after app exit',async()=>{
  const {store,service}=await fixture();const profile=await call(service,'profile/create',{name:'Cancellation fixture',provider:'codex',model:'fake'});
  let reject!: (e:Error)=>void;let started!:()=>void;let stopped=0;const ready=new Promise<void>(r=>started=r);const completion=new Promise<void>((_,no)=>reject=no);void completion.catch(()=>{});
  const verifier=new ProfileVerifier(store,()=>{},async()=>{started();return{sessionId:'fake',completion,stop:async()=>{stopped++;reject(new Error('Stopped fixture'));}};},async()=>({runtime:'fake',version:'1',node:process.versions.node}));
  const check=verifier.start(profile.id);await ready;await verifier.shutdown();expect(stopped).toBeGreaterThan(0);
  expect((store.db.prepare('SELECT state FROM profile_checks WHERE id=?').get(check.id) as any).state).toBe('failed');
  expect(JSON.parse((store.db.prepare('SELECT capabilities FROM profiles WHERE id=?').get(profile.id) as any).capabilities).modes).toEqual([]);
});
