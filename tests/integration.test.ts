import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { JsonProcess, cleanEnvironment } from '../runtime/process.js';
import { git } from '../runtime/git.js';
import { createCheckpoint, restoreCheckpoint, contextPack } from '../runtime/checkpoint.js';
import { allowanceAmount, battery, daysUntilReset, calibratedBaseline, BudgetLedger } from '../runtime/budget.js';

const folders: string[] = []; const stores: Store[] = [];
function temp() { const p = mkdtempSync(join(tmpdir(), 'lagoto-integration-')); folders.push(p); return p; }
function setup() { const store = new Store(temp()); stores.push(store); return { store, service: new Service(store) }; }
const call = (service: Service, method: string, params: Record<string, unknown> = {}) => service.handle({ jsonrpc: '2.0', id: 'test', method, params }) as Promise<any>;
afterEach(() => { for (const store of stores.splice(0)) { try { store.close(); } catch {} } for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true }); });
describe('Runtime integration', () => {
  it('P00-I04 exercises the actual bundled Node and SQLite without system Node or shell PATH', async () => {
    const runtime = resolve('build/Xcode/Build/Products/Debug/Lagoto.app/Contents/Resources/runtime');
    const client = new JsonProcess(join(runtime, 'node'), [join(runtime, 'dist/runtime/server.js')], runtime,
      { HOME: process.env.HOME!, PATH: '/usr/bin:/bin', LAGOTO_DATA_DIR: temp() });
    try {
      expect(await client.request('initialize', { protocolVersion: 1 })).toMatchObject({ protocolVersion: 1, arch: 'arm64' });
      const project = await client.request('project/create', { name: 'Bundled sqlite' });
      expect(await client.request('project/list', {})).toMatchObject([{ id: project.id, name: 'Bundled sqlite' }]);
    } finally { await client.stop(); }
  });
  it('P01-I03 recovers database ownership after a killed process', async () => {
    const directory = temp(); const child = spawn(process.execPath, ['dist/runtime/server.js'], { cwd: process.cwd(), env: { ...cleanEnvironment(), LAGOTO_DATA_DIR: directory }, stdio: 'pipe' });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'x', method: 'initialize', params: { protocolVersion: 1 } }) + '\n');
    await new Promise<void>((resolve, reject) => { child.stdout.once('data', () => resolve()); child.once('error', reject); });
    const dead = new Promise(resolve => child.once('close', resolve)); child.kill('SIGKILL'); await dead;
    const store = new Store(directory); stores.push(store); expect(store.db.prepare('SELECT count(*) AS count FROM projects').get()).toEqual({ count: 0 });
  });
  it('P05-I06 parses split UTF-8 frames and rejects an unknown RPC without corrupting later responses', async () => {
    const directory = temp(); const child = spawn(process.execPath, ['dist/runtime/server.js'], { env: { ...cleanEnvironment(), LAGOTO_DATA_DIR: directory }, stdio: 'pipe' });
    const messages: any[] = []; let buffer = ''; const done = new Promise<void>((resolve, reject) => {
      child.once('error', reject); child.stdout.on('data', data => { buffer += data.toString(); let i: number;
        while ((i = buffer.indexOf('\n')) >= 0) { messages.push(JSON.parse(buffer.slice(0, i))); buffer = buffer.slice(i + 1); if (messages.length === 4) resolve(); }
      });
    });
    const frames = Buffer.from([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } },
      { jsonrpc: '2.0', id: 2, method: 'project/create', params: { name: 'Caffè 🐕' } },
      { jsonrpc: '2.0', id: 3, method: 'execute/arbitrary', params: {} },
      { jsonrpc: '2.0', id: 4, method: 'project/list', params: {} },
    ].map(v => JSON.stringify(v)).join('\n') + '\n');
    for (let i = 0; i < frames.length; i += 7) child.stdin.write(frames.subarray(i, i + 7));
    await done; const exited = new Promise(resolve => child.once('close', resolve)); child.stdin.end(); await exited;
    expect(messages[1].result.name).toBe('Caffè 🐕'); expect(messages[2].error.code).toBe(-32601); expect(messages[3].result).toHaveLength(1);
  });
});
describe('Recovery primitives (partial P07, not a full Git restore gate)', () => {
  it('P07-I01 MEM-01 preserves included binary bytes and detects corruption before restore', async () => {
    const { store, service } = setup(); const repo = temp(); await git(repo, ['init']); await git(repo, ['config','user.name','Lagoto Test']); await git(repo, ['config','user.email','test@example.invalid']);
    writeFileSync(join(repo,'file.txt'),'base'); await git(repo,['add','file.txt']); await git(repo,['commit','-m','base']);
    const p = await call(service,'project/create',{name:'Recovery'}); const r = await call(service,'repository/add',{projectId:p.id,path:repo}); const t = await call(service,'task/create',{projectId:p.id,title:'Binary'});
    const [worktree] = await call(service,'task/prepare',{taskId:t.id,repositoryIds:[r.id]}); const bytes=Buffer.from([0,255,13,10,42]); writeFileSync(join(worktree.path,'binary.bin'),bytes); writeFileSync(join(worktree.path,'.env'),'SECRET=not-exported');
    const checkpoint=await createCheckpoint(store,t.id); const destination=join(temp(),'restore'); await restoreCheckpoint(store,checkpoint.id,destination);
    expect(readFileSync(join(destination,r.id,'binary.bin'))).toEqual(bytes); expect(checkpoint.repositories[0]!.excluded).toContain('.env');
    expect(contextPack(store,t.id,24000).content).toContain('Binary'); expect(()=>contextPack(store,t.id,10)).toThrow('nucleo');
    const blob=checkpoint.repositories[0]!.entries.find(e=>e.path==='binary.bin')!.hash!; writeFileSync(join(store.directory,'blobs',blob),'corrupted');
    await expect(restoreCheckpoint(store,checkpoint.id,join(temp(),'broken'))).rejects.toThrow('Checksum');
  });
});
describe('Budget accounting integration (partial P09)', () => {
  it('P05-I07/P09-I07 BAT-01/BAT-06/BAT-14 freezes shared allowance, reserves atomically and settles exactly once', () => {
    const {store}=setup(); const ledger=new BudgetLedger(store); const assigned=allowanceAmount(30000000,3000000,30);
    const a=ledger.open('account-pool','2026-10-05','cycle-1','microEUR',assigned);
    expect(ledger.open('account-pool','2026-10-05','cycle-1','microEUR',100).assigned).toBe(900000);
    ledger.reserve(a.id,360000,'first'); ledger.settle('first',360000); ledger.settle('first',360000);
    ledger.reserve(a.id,180000,'second'); expect(battery(assigned,360000,180000)).toBe(40);
    ledger.settle('second',120000); const row=store.db.prepare('SELECT spent,reserved FROM allowances WHERE id=?').get(a.id) as {spent:number;reserved:number};
    expect(row).toEqual({spent:480000,reserved:0}); expect(battery(assigned,row.spent,row.reserved)).toBeCloseTo(46.6667,3);
    expect(()=>ledger.reserve(a.id,500000,'over')).toThrow('insufficiente');
  });
  it('P09-I07/P09-I08 BAT-12/BAT-17 counts calendar days over DST and requires seven complete active days', () => {
    expect(daysUntilReset(new Date('2026-10-24T10:00:00+02:00'),new Date('2026-10-27T00:00:00+01:00'))).toBe(3);
    expect(daysUntilReset(new Date('2026-09-28T10:00:00+02:00'),new Date('2026-10-01T12:00:00+02:00'))).toBe(4);
    expect(calibratedBaseline([80,100,120,90,110,70,130].map(amount=>({amount,complete:true})))).toBe(100);
    expect(calibratedBaseline([{amount:100,complete:true}])).toBeNull();
  });
});
