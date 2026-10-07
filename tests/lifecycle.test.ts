import {readdirSync} from 'node:fs';
import { afterEach, describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { RunManager } from '../runtime/runs.js';
import { migrate } from '../runtime/migrate.js';
import { JsonProcess } from '../runtime/process.js';
import { ScopedFiles } from '../runtime/scoped-files.js';

const folders: string[] = []; const stores: Store[] = [];
function temp() { const path = mkdtempSync(join(tmpdir(), 'lagoto-lifecycle-')); folders.push(path); return path; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const folder of folders.splice(0)) rmSync(folder, { force: true, recursive: true }); });
describe('Lifecycle primitives', () => {
  it('P01-I04 migrates a P00 v1 database without losing data or silently opening a newer schema', () => {
    const db = new Database(':memory:');
    db.exec(readFileSync('runtime/migrations/001-foundation.sql','utf8'));
    db.exec("INSERT INTO migrations VALUES(1,'fixture'); INSERT INTO projects VALUES('project','Preserve',0,'fixture'); CREATE TABLE run_requests(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id))");
    migrate(db); expect(db.prepare('SELECT name FROM projects').get()).toEqual({name:'Preserve'});
    expect((db.pragma('table_info(run_requests)') as { name: string }[]).map(row=>row.name)).toContain('fingerprint');
    migrate(db); expect(db.prepare('SELECT count(*) AS count FROM migrations').get()).toEqual({count:readdirSync('runtime/migrations').filter(name=>name.endsWith('.sql')).length});
    db.exec("INSERT INTO migrations VALUES(999,'future')"); expect(()=>migrate(db)).toThrow('più recente'); db.close();
  });
  it('P04-I03 single writer, request fingerprint and shutdown remain valid during asynchronous finalization', async () => {
    const store=new Store(temp()); stores.push(store); const service=new Service(store);
    const call=async(method:string,params:Record<string,unknown>)=>service.handle({jsonrpc:'2.0',id:'test',method,params}) as Promise<any>;
    const project=await call('project/create',{name:'Lifecycle'}); const task=await call('task/create',{projectId:project.id,title:'Controlled fake'});
    const profile=await call('profile/create',{name:'Fake fixture',provider:'codex',model:'fixture-only'});
    store.db.prepare('UPDATE profiles SET capabilities=? WHERE id=?').run(JSON.stringify({modes:['agent'],efforts:[]}),profile.id);
    store.db.prepare('INSERT INTO repositories(id,project_id,name,path,git_root,remote) VALUES(?,?,?,?,?,?)').run('repo',project.id,'Synthetic',temp(),null,null);
    store.db.prepare('INSERT INTO task_repositories VALUES(?,?,?,?,?)').run(task.id,'repo',temp(),'fixture','base');
    const turn=deferred(), stopped=deferred(); let stops=0, launches=0;
    const runs=new RunManager(store,()=>{},async()=>{ launches++; return {sessionId:'fake',completion:turn.promise,stop:async()=>{stops++;await stopped.promise;}}; });
    const id=crypto.randomUUID(); const first=await runs.start(task.id,profile.id,'Prompt',id,'agent');
    expect(await runs.start(task.id,profile.id,'Prompt',id,'agent')).toMatchObject({id:(first as any).id});
    await expect(runs.start(task.id,profile.id,'Changed prompt',id,'agent')).rejects.toThrow('contenuti diversi');
    await expect(runs.start(task.id,profile.id,'Second writer',crypto.randomUUID(),'agent')).rejects.toThrow('possiede');
    turn.resolve(); await Promise.resolve(); let closed=false;
    const shutdown=runs.shutdown().then(()=>{closed=true;}); await Promise.resolve(); expect(closed).toBe(false);
    stopped.resolve(); await shutdown;
    expect(stops).toBe(1); expect(launches).toBe(1); expect(store.events(task.id).filter(e=>(e as any).kind==='user')).toHaveLength(1);
    expect(store.db.prepare('SELECT state FROM runs').get()).toEqual({state:'finished'});
  });
  it('shares one stop verification across simultaneous callers', async () => {
    const client=new JsonProcess(process.execPath,['-e','process.stdin.resume(); process.stdin.on("end",()=>process.exit(0))'],temp());
    const a=client.stop(),b=client.stop(); expect(a).toBe(b); await a;
  });
  it('keeps a surviving child uncertain on every stop attempt', async () => {
    const script = `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(JSON.stringify({method:'ready',params:{pid:child.pid}})); process.exit(0);`;
    const client = new JsonProcess(process.execPath, ['-e', script], temp());
    const child = await new Promise<number>(resolve => { client.onMessage = message => resolve(message.params.pid); });
    if (client.child.exitCode === null) await new Promise(resolve => client.child.once('exit', resolve));
    try {
      await expect(client.stop()).rejects.toThrow('figlio ancora attivo');
      await expect(client.stop()).rejects.toThrow('figlio ancora attivo');
    } finally { process.kill(child, 'SIGTERM'); }
  });
  it('stops an observed descendant after its parent exits on EOF', async () => {
    const script = `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(JSON.stringify({method:'ready',params:{pid:child.pid}})); process.stdin.resume(); process.stdin.on('end',()=>process.exit(0));`;
    const client=new JsonProcess(process.execPath,['-e',script],temp());
    const child=await new Promise<number>(resolve=>{client.onMessage=message=>resolve(message.params.pid);});
    try { await client.stop(); expect(()=>process.kill(child,0)).toThrow(); }
    finally { try { process.kill(child,'SIGTERM'); } catch {} }
  });
  it('P04-I04 rejects ACP paths outside the granted roots, including symlinks and Git internals', async () => {
    const root=temp(),outside=temp(); writeFileSync(join(outside,'private.txt'),'fixture'); symlinkSync(outside,join(root,'escape'));
    const files=new ScopedFiles([root]); await files.write(join(root,'allowed.txt'),'a\nb\n');
    expect(await files.read(join(root,'allowed.txt'),2,1)).toEqual({content:'b\n'});
    await expect(files.read(join(root,'escape/private.txt'))).rejects.toThrow('esterno');
    await expect(files.write(join(outside,'blocked.txt'),'no')).rejects.toThrow('esterno');
    await expect(files.write(join(root,'.git/config'),'no')).rejects.toThrow('autorizzato');
  });
  it('P01-I04 does not journal a successful save when SQLite is full', async () => {
    const store=new Store(temp());stores.push(store); const service=new Service(store);
    const p=await service.handle({jsonrpc:'2.0',id:'p',method:'project/create',params:{name:'Full disk'}}) as {id:string};
    const t=await service.handle({jsonrpc:'2.0',id:'t',method:'task/create',params:{projectId:p.id,title:'Keep'}}) as {id:string};
    const pages=store.db.pragma('page_count',{simple:true}) as number; store.db.pragma(`max_page_count=${pages}`);
    expect(()=>store.event(t.id,null,'text',{text:'x'.repeat(1024*1024)})).toThrow();
    expect(store.events(t.id)).toHaveLength(0); expect(store.task(t.id).title).toBe('Keep');
  });
  it('P01-I02 decodes the same contract fixture as native Swift Codable', () => {
    const fixture=JSON.parse(readFileSync('fixtures/protocol-v1.json','utf8'));
    expect(fixture[0].result.text).toBe('Caffè 🐕'); expect(fixture[1].error.code).toBe(409);
    expect(fixture[2].params.payload.text).toContain('```swift'); expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
  });
});
