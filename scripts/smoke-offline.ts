import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import net from 'node:net';
import {JsonProcess,cleanEnvironment,executable} from '../runtime/process.js';
import {startAdapter,type AdapterEvent} from '../runtime/adapters.js';
import {provenance,sourceFingerprint} from './evidence.js';
import {redact} from '../runtime/protocol.js';
import {Store} from '../runtime/storage.js';
import {Service} from '../runtime/service.js';
import {transcript} from '../runtime/transcript.js';

const policy='(version 1)(allow default)(deny network*)(allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))';
  const metadata=provenance();const report:any={...metadata,status:'failed',policy,model:process.env.LAGOTO_OFFLINE_MODEL??'qwen3.5:4b',steps:[],scope:'Separate official Ollama server, SDK worker and their descendants denied non-loopback networking by macOS sandbox. Supervisor outside sandbox observes/stops process groups. No system network settings changed.'};
  let daemon:JsonProcess|undefined,session:Awaited<ReturnType<typeof startAdapter>>|undefined;const events:AdapterEvent[]=[];
  try{
    const denied=execFileSync('/usr/bin/sandbox-exec',['-p',policy,process.execPath,'-e',`const s=require('node:net').connect(443,'1.1.1.1');s.on('connect',()=>{s.destroy();console.log('connected')});s.on('error',e=>console.log(e.code));s.setTimeout(3000,()=>{s.destroy();console.log('timeout')});`],{env:cleanEnvironment(),encoding:'utf8',timeout:5000}).trim();
    if(denied!=='EPERM')throw new Error(`Network denial not proved: ${denied}`);
    report.steps.push('External numeric-IP connection denied by OS with EPERM');
    const port=await new Promise<number>((resolve,reject)=>{const probe=net.createServer();probe.on('error',reject);probe.listen(0,'127.0.0.1',()=>{const port=(probe.address() as net.AddressInfo).port;probe.close(error=>error?reject(error):resolve(port));});});
    const host=`http://127.0.0.1:${port}`;const root=await mkdtemp(join(tmpdir(),'lagoto-offline-'));const binary=executable('ollama');if(!binary)throw new Error('Official Ollama CLI unavailable');
    daemon=new JsonProcess('/usr/bin/sandbox-exec',['-p',policy,binary,'serve'],root,cleanEnvironment({OLLAMA_HOST:`127.0.0.1:${port}`,OLLAMA_MODELS:process.argv[2]??join(homedir(),'.ollama/models'),OLLAMA_NO_CLOUD:'1',OLLAMA_NOPRUNE:'1',OLLAMA_KEEP_ALIVE:'0',OLLAMA_CONTEXT_LENGTH:'16384'}),'text');
    let closed=false;daemon.onClose=()=>{closed=true;};
    let tags:any;
    for(let attempt=0;attempt<100;attempt++){
      if(closed)throw new Error('Isolated Ollama daemon exited before readiness');
      try{const response=await fetch(host+'/api/tags',{signal:AbortSignal.timeout(500)});if(response.ok){tags=await response.json();break;}}catch{}
      await new Promise(r=>setTimeout(r,100));
    }
    if(!tags)throw new Error('Isolated daemon readiness failed');
    if(!tags.models?.some((m:any)=>m.name===report.model&&!m.remote_host))throw new Error('Required local model not available; no download attempted');
    const show=await fetch(host+'/api/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:report.model}),signal:AbortSignal.timeout(3000)});
    const model:any=await show.json();if(!show.ok||model.remote_host||model.remote_model)throw new Error('Expected a locally installed model');
    report.steps.push('Separate Ollama server and model runners inherit the same OS network denial; cloud features disabled; local model present');
    const roots=[];for(const name of ['backend','frontend','desktop']){const path=join(root,name);await mkdir(path);await writeFile(join(path,'fixture.txt'),`LAGOTO_${name.toUpperCase()}_V1\n`);roots.push(path);}
    session=await startAdapter({profile:{id:crypto.randomUUID(),name:'Offline acceptance fixture',provider:'ollama',model:report.model,endpoint:host+'/v1',executable:null,capabilities:'{}'},cwd:roots[0]!,directories:roots,home:join(root,'sdk-home'),mode:'agent',
      prompt:`Read fixture.txt from each of these three directories: ${roots.join(', ')}. Write only result.txt in the first directory, containing exactly LAGOTO_BACKEND_V1, LAGOTO_FRONTEND_V1 and LAGOTO_DESKTOP_V1 on separate lines, with a final newline. Use file tools; do not run shell commands or subagents. Then reply LAGOTO_OK.`,
      permission:async(tool,input)=>/edit|write|fileChange/i.test(tool)&&JSON.stringify(input).includes('result.txt')&&!JSON.stringify(input).includes('..')&&!/command|bash|shell/i.test(tool),onEvent:e=>events.push(e),
      workerLauncher:(command,args,cwd,environment)=>new JsonProcess('/usr/bin/sandbox-exec',['-p',policy,command,...args],cwd,environment)});
    let timer:NodeJS.Timeout|undefined;try{await Promise.race([session.completion,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Offline model timeout')),150000);})]);}finally{clearTimeout(timer);}
    if(await readFile(join(roots[0]!,'result.txt'),'utf8')!=='LAGOTO_BACKEND_V1\nLAGOTO_FRONTEND_V1\nLAGOTO_DESKTOP_V1\n')throw new Error('Independent byte assertion failed');
    if(!events.some(e=>e.kind==='result')||!events.some(e=>e.kind==='text')||!events.some(e=>e.kind==='tool'))throw new Error('Required streaming/tool/final events missing');
    report.steps.push('SDK adapter read all three roots, wrote exact expected bytes and emitted streaming/tool/final events while external network remained denied');
    const store=new Store(join(root,'projection'));
    try{
      const service=new Service(store);const call=(method:string,params:Record<string,unknown>)=>service.handle({jsonrpc:'2.0',id:1,method,params}) as Promise<any>;
      const project=await call('project/create',{name:'Offline synthetic projection'});
      const task=await call('task/create',{projectId:project.id,title:'Preserve model response'});
      const profile=await call('profile/create',{name:'Offline fixture',provider:'ollama',model:report.model});const run=crypto.randomUUID();
      store.db.prepare('INSERT INTO runs(id,task_id,profile_id,state,model,created_at) VALUES(?,?,?,?,?,?)').run(run,task.id,profile.id,'finished',profile.model,new Date().toISOString());
      for(const event of events)store.event(task.id,run,event.kind,event);
      const blocks=transcript(store.db,task.id).blocks as any[];
      const final=events.findLast(e=>e.kind==='result')?.text;
      if(!final||blocks.filter(b=>b.kind==='text'&&b.text===final).length!==1)throw new Error('Final answer absent or duplicated in persisted transcript');
      report.projection={finalOccurrences:1,blocks:blocks.length,tools:blocks.filter(b=>b.kind==='tool').length};
      report.steps.push('Actual SDK events projected through durable SQLite journal: final answer appears once in conversation');
    }finally{store.close();}
    if(sourceFingerprint()!==metadata.sourceFingerprint)throw new Error('Sources changed during test');report.status='passed';
  }catch(error){report.error=String(redact(error instanceof Error?error.message:String(error)));}
  finally{
    try{await session?.stop();await daemon?.stop();report.steps.push('SDK worker and isolated Ollama process groups stopped');}
    catch(error){report.status='failed';report.stopError=String(redact(String(error)));}
  }
  report.counts=Object.fromEntries(['text','tool','result','usage','raw'].map(kind=>[kind,events.filter(e=>e.kind===kind).length]));
  await mkdir('build/evidence',{recursive:true});const output=`build/evidence/ollama-offline-${metadata.date.replaceAll(':','-')}.json`;await writeFile(output,JSON.stringify({...report,events:redact(events)},null,2));
  console.log(JSON.stringify({...report,events:undefined,evidence:output},null,2));process.exitCode=report.status==='passed'?0:1;
