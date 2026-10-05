import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {Store} from '../runtime/storage.js';
import {Service} from '../runtime/service.js';
import {provenance} from './evidence.js';
const metadata=provenance();const root=await mkdtemp(join(tmpdir(),'lagoto-load-'));const store=new Store(root);const service=new Service(store);const tasks:string[]=[];
try{
  const setupStarted=performance.now();
  store.db.transaction(()=>{
    for(let i=0;i<50;i++){
      const project=randomUUID();store.db.prepare('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)').run(project,`Load project ${i}`,metadata.date);
      for(let j=0;j<20;j++){
        const task=randomUUID();tasks.push(task);store.db.prepare('INSERT INTO tasks(id,project_id,title,objective,created_at) VALUES(?,?,?,?,?)').run(task,project,`Task ${j}`,'Synthetic performance fixture',metadata.date);
        for(let k=0;k<100;k++)store.event(task,null,k%2?'text':'user',{text:`Event ${k}: synthetic response with a table | repository | status | and code \`node test.mjs\`.`});
      }
    }
  })();
  const setupMs=performance.now()-setupStarted;
  const samples:number[]=[];
  for(let i=0;i<1200;i++){const start=performance.now();const result=await service.handle({jsonrpc:'2.0',id:'load',method:'task/snapshot',params:{taskId:tasks[(i*37)%tasks.length]}});JSON.parse(JSON.stringify(result));if(i>=200)samples.push(performance.now()-start);}
  samples.sort((a,b)=>a-b);const p95=samples[Math.ceil(samples.length*.95)-1]!;
  const report={...metadata,status:p95<300?'passed':'failed',scope:'Runtime task snapshot and JSON encode/decode only. Does not certify native UI task-switch p95.',projects:50,tasks:1000,events:100000,setupMs,samples:samples.length,p95Ms:p95,maximumMs:samples.at(-1),fixtureDirectory:root};
  await mkdir('build/evidence',{recursive:true});await writeFile(`build/evidence/performance-${metadata.date.replaceAll(':','-')}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=p95<300?0:1;
}finally{store.close();}
