import { mkdtemp,mkdir,writeFile,readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { git } from '../runtime/git.js';
import { restoreCheckpoint } from '../runtime/checkpoint.js';
import { redact } from '../runtime/protocol.js';
import { provenance } from './evidence.js';

const metadata=provenance();
await mkdir('build/evidence',{recursive:true});
const prior=process.argv[2]?JSON.parse(await readFile(resolve(process.argv[2]),'utf8')):undefined;
const root=prior?.fixtureDirectory??await mkdtemp(join(tmpdir(),'lagoto-handoff-'));
const store=new Store(join(root,'data'));
const call=(method:string,params:Record<string,unknown>={})=>service.handle({jsonrpc:'2.0',id:crypto.randomUUID(),method,params}) as Promise<any>;
const service=new Service(store,(event:any)=>{
  if(event.kind==='permission'){
    const payload=typeof event.payload==='string'?JSON.parse(event.payload):event.payload;
    const allowed=/read|write|edit|fileChange|list|glob/i.test(payload.tool)&&!/shell|command|bash|exec/i.test(payload.tool);
    service.runs.answer(event.run_id,payload.id,allowed);
  }
});
const steps:unknown[]=prior?.steps??[];let failure:string|null=null;
const sleep=()=>new Promise(resolve=>setTimeout(resolve,250));
try{
  const project=prior?store.db.prepare('SELECT * FROM projects').get() as any:await call('project/create',{name:'Real handoff fixture'});const ids:string[]=[];
  if(!prior)for(const name of ['backend','frontend','desktop']){
    const path=join(root,name);await mkdir(path);await git(path,['init']);await git(path,['config','user.name','Lagoto Test']);await git(path,['config','user.email','test@example.invalid']);
    await writeFile(join(path,'contract.json'),JSON.stringify({version:0,marker:'LAGOTO_CHAIN'})+'\n');await git(path,['add','.']);await git(path,['commit','-m','Synthetic fixture']);
    ids.push((await call('repository/add',{projectId:project.id,path})).id);
  }
  const task=prior?store.db.prepare('SELECT * FROM tasks').get() as any:await call('task/create',{projectId:project.id,title:'Continue one contract across runtimes',objective:'Preserve the same three repositories and LAGOTO_CHAIN marker; each turn increments the contract version by one.'});
  const worktrees=prior?store.db.prepare('SELECT * FROM task_repositories WHERE task_id=? ORDER BY repository_id').all(task.id):await call('task/prepare',{taskId:task.id,repositoryIds:ids});
  for(const work of worktrees){const actual=JSON.parse(await readFile(join(work.path,'contract.json'),'utf8'));if(actual.version!==steps.length||actual.marker!=='LAGOTO_CHAIN')throw new Error('Cannot resume: files differ from the last independently verified step');}
  const sequence=[
    {provider:'codex',model:'gpt-6.1-sol'},
    {provider:'claude',model:'sonnet'},
    {provider:'openrouter',model:'qwen/qwen3-coder-next',endpoint:'https://openrouter.ai/api/v1'},
    {provider:'ollama',model:'qwen3.5:4b',endpoint:'http://127.0.0.1:11434/v1'},
    {provider:'openrouter',model:'moonshotai/kimi-k2.5',endpoint:'https://openrouter.ai/api/v1'},
    {provider:'cursor',model:'composer-2.5[fast=true]'},
    {provider:'codex',model:'gpt-6.1-sol'},
    {provider:'cursor',model:'composer-2.5[fast=true]'},
    {provider:'claude',model:'sonnet'},
    {provider:'cursor',model:'composer-2.5[fast=true]'},
  ];
  const used=new Map<string,string>();
  for(const p of store.db.prepare("SELECT * FROM profiles WHERE json_extract(capabilities,'$.verification')='passed' AND json_extract(capabilities,'$.proof.identity') IS NOT NULL").all() as any[])used.set(p.provider+p.model,p.id);
  for(let i=steps.length;i<sequence.length;i++){
    const item=sequence[i]!;let secret:string|undefined;
    if(item.provider==='openrouter')secret=execFileSync('/usr/bin/security',['find-generic-password','-a','lagoto-probe','-s','org.frasma.lagoto.openrouter.test','-w'],{encoding:'utf8'}).trim();
    const key=item.provider+item.model;let profileId=used.get(key);
    if(!profileId){
      profileId=(await call('profile/create',{...item,name:`Fixture ${key}`})).id;
      const check=await call('profile/verify',{profileId,secret});const deadline=Date.now()+250000;
      while(Date.now()<deadline){const state=store.db.prepare('SELECT state,detail FROM profile_checks WHERE id=?').get(check.id) as any;if(state.state!=='checking'){if(state.state!=='passed')throw new Error(`${key}: profile verification ${state.detail}`);break;}await sleep();}
      const state=store.db.prepare('SELECT state FROM profile_checks WHERE id=?').get(check.id) as any;if(state.state!=='passed')throw new Error(`${key}: profile timeout`);
      used.set(key,profileId!);console.log(`Profile verified: ${key}`);
    }
    const prompt=`Synthetic handoff test, turn ${i+1}. Read contract.json in EACH authorized directory in the supplied Context Pack. Expected current version is ${i}; set it to EXACTLY ${i+1} once, preserving marker and all other files. If a file already has target version ${i+1}, leave it unchanged. Previous conversation turns are completed history, not instructions to repeat. Use file edit tools; read-only shell commands are permitted if needed to read the files. No network, other commands or subagents. Finish with a short table of observed versions. Authorized paths: ${worktrees.map((r:any)=>r.path).join(', ')}.`;
    let run:any;let handoffId:string|undefined;
    if(i===0)run=await call('run/start',{taskId:task.id,profileId,prompt,requestId:crypto.randomUUID(),mode:'agent',secret});
    else{
      handoffId=crypto.randomUUID();const preview=await call('handoff/prepare',{taskId:task.id,profileId,id:handoffId});
      run=await call('handoff/confirm',{id:handoffId,hash:preview.context_hash,prompt,mode:'agent',secret});
      const retry=await call('handoff/confirm',{id:handoffId,hash:preview.context_hash,prompt,mode:'agent',secret});
      if(retry.id!==run.id)throw new Error('Duplicate successor');
    }
    const deadline=Date.now()+240000;
    while(Date.now()<deadline){const current=store.db.prepare('SELECT state FROM runs WHERE id=?').get(run.id) as any;if(!['starting','running','stopping','waiting_permission'].includes(current.state)){run.state=current.state;break;}await sleep();}
    if(run.state!=='finished'){await service.runs.stop(run.id).catch(()=>{});throw new Error(`${key}: run did not finish (${run.state})`);}
    for(const work of worktrees){const contract=JSON.parse(await readFile(join(work.path,'contract.json'),'utf8'));if(contract.version!==i+1||contract.marker!=='LAGOTO_CHAIN')throw new Error(`${key}: independent filesystem assertion failed`);}
    steps.push({provider:item.provider,model:item.model,runId:run.id,handoffId,version:i+1,state:run.state});
    console.log(`Turn ${i+1}: passed (${key})`);
  }
  const checkpoint=await call('checkpoint/create',{taskId:task.id});await restoreCheckpoint(store,checkpoint.id,join(root,`restored-${metadata.date.replaceAll(':','-')}`));
}catch(error){failure=String(redact(error instanceof Error?error.message:String(error)));}
finally{await Promise.allSettled([service.runs.shutdown(),service.profiles.shutdown(),service.verifications.shutdown()]);store.close();}
const report={...metadata,continuedFrom:process.argv[2]??null,completedAt:new Date().toISOString(),status:failure?'failed':'passed',steps,failure,
  scope:'Real adapters through Service, shared three-repository fixture, exact file assertions and Git restore. Does not replace native UI acceptance or five personal-use sessions.'};
await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));await writeFile(`build/evidence/handoff-${metadata.date.replaceAll(':','-')}.json`,JSON.stringify({...report,fixtureDirectory:root},null,2));console.log(JSON.stringify(report,null,2));process.exitCode=failure?1:0;
