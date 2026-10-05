import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {Store} from '../runtime/storage.js';
import {ProcessLeases} from '../runtime/process-leases.js';
const paths:string[]=[];const stores:Store[]=[];
afterEach(()=>{stores.splice(0).forEach(s=>s.close());paths.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true}));});
it('P05-I03/P12-I02 reconciles a live child after its owning runtime is killed, using the durable identity',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'lagoto-crash-'));paths.push(directory);
  const driver=join(directory,'driver.mjs');const url=(file:string)=>pathToFileURL(resolve(file)).href;
  writeFileSync(driver,`import {Store} from ${JSON.stringify(url('runtime/storage.ts'))}; import {JsonProcess} from ${JSON.stringify(url('runtime/process.ts'))}; import {ProcessLeases} from ${JSON.stringify(url('runtime/process-leases.ts'))};
const store=new Store(${JSON.stringify(directory)});const child=new JsonProcess(process.execPath,['-e','setInterval(()=>{},1000)'],${JSON.stringify(directory)});new ProcessLeases(store).track('fixture','owned',child);console.log(child.child.pid);setInterval(()=>{},1000);`);
  const driverProcess=spawn(process.execPath,['--import','tsx',driver],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
  let child:number|undefined;let stderr='';driverProcess.stderr.on('data',chunk=>stderr+=chunk);
  try{
    child=await new Promise<number>((yes,no)=>{driverProcess.stdout.once('data',chunk=>yes(Number(String(chunk).trim())));driverProcess.once('exit',()=>no(new Error(stderr||'Driver exited before registering')));setTimeout(()=>no(new Error('Driver timeout')),10000).unref();});
    expect(child).toBeGreaterThan(0);const exited=new Promise(resolve=>driverProcess.once('exit',resolve));driverProcess.kill('SIGKILL');await exited;
    expect(()=>process.kill(child!,0)).not.toThrow();
    const recovered=new Store(directory);stores.push(recovered);expect(await new ProcessLeases(recovered).reconcile('fixture','owned')).toMatchObject({stopped:true});
    expect(()=>process.kill(child!,0)).toThrow();expect(recovered.db.prepare('SELECT state FROM process_leases').get()).toEqual({state:'stopped'});
  }finally{driverProcess.kill('SIGKILL');if(child)try{process.kill(child,'SIGKILL');}catch{}}
},15000);
it('P05-I03 refuses to signal a reused PID and never calls it a verified stop',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'lagoto-pid-'));paths.push(directory);const store=new Store(directory);stores.push(store);
  store.db.prepare('INSERT INTO process_leases VALUES(?,?,?,?,?,?,?,?)').run('lease','fixture','pid-reuse',98765,'old',JSON.stringify([{pid:98765,group:98765,started:'old'}]),'unknown',new Date().toISOString());
  let signals=0;const registry=new ProcessLeases(store,()=>[{pid:98765,group:98765,started:'new'}],()=>{signals++;return true;});
  await expect(registry.reconcile('fixture','pid-reuse')).rejects.toThrow('PID riutilizzato');expect(signals).toBe(0);
  expect(store.db.prepare('SELECT state FROM process_leases').get()).toEqual({state:'unknown'});
});
