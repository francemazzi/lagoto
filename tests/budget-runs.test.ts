import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../runtime/storage.js';
import {Service} from '../runtime/service.js';
import {RunBudgets} from '../runtime/budget.js';

const stores:Store[]=[];const dirs:string[]=[];
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
async function fixture(){
  const path=mkdtempSync(join(tmpdir(),'lagoto-budget-'));dirs.push(path);const store=new Store(path);stores.push(store);const service=new Service(store);
  const call=(method:string,params:Record<string,unknown>)=>service.handle({jsonrpc:'2.0',id:'test',method,params}) as Promise<any>;
  const p=await call('project/create',{name:'Budget fixture'});const task=await call('task/create',{projectId:p.id,title:'Budget'});
  const a=await call('profile/create',{name:'A',provider:'codex',model:'fixture-a'});const b=await call('profile/create',{name:'B',provider:'codex',model:'fixture-b'});
  const pool=await call('budget/create',{name:'One account',residual:100000,resetAt:new Date(Date.now()+2*86400000).toISOString()});
  for(const profile of [a,b])await call('budget/link',{profileId:profile.id,poolId:pool.id,reservation:5000});
  const addRun=(profile:string)=>{const id=crypto.randomUUID();store.db.prepare('INSERT INTO runs(id,task_id,profile_id,state,model,created_at) VALUES(?,?,?,?,?,?)').run(id,task.id,profile,'finished','fixture',new Date().toISOString());return id;};
  return{store,call,a,b,pool,addRun};
}
it('P05-I07/P09-I02 BAT-06/BAT-14 model switches use the same allowance and a duplicate cumulative usage event never charges twice',async()=>{
  const {store,a,b,addRun,pool}=await fixture();const budgets=new RunBudgets(store);const id=addRun(a.id);
  budgets.reserve(id,a.id);budgets.observe(id,{payload:{tokenUsage:{total:{totalTokens:3000}}}});budgets.observe(id,{payload:{tokenUsage:{total:{totalTokens:3000}}}});budgets.finish(id,'finished');budgets.finish(id,'finished');
  const first=budgets.status(a.id),second=budgets.status(b.id);
  expect(first.allowance!.id).toBe(second.allowance!.id);expect(second.allowance!.spent).toBe(3000);expect(second.allowance!.reserved).toBe(0);
  expect((store.db.prepare('SELECT residual,reserve FROM budget_pools WHERE id=?').get(pool.id))).toEqual({residual:97000,reserve:10000});
});
it('P09-I02/P09-I09 BAT-10/BAT-11 keeps uncertain commitments across restart and midnight; zero blocks the next turn',async()=>{
  const {store,a,addRun}=await fixture();const budgets=new RunBudgets(store);const id=addRun(a.id);budgets.reserve(id,a.id);budgets.finish(id,'unknown');
  const today=budgets.status(a.id);const tomorrow=budgets.status(a.id,new Date(Date.now()+86400000));
  expect(today.allowance!.reserved).toBe(5000);expect(tomorrow.allowance!.reserved).toBe(0);
  expect(tomorrow.allowance!.assigned).toBeLessThan(45000);
  store.db.prepare('UPDATE allowances SET spent=assigned WHERE id=?').run(today.allowance!.id);
  const next=addRun(a.id);expect(()=>budgets.reserve(next,a.id)).toThrow('insufficiente');
  const path=store.directory;store.close();const reopened=new Store(path);stores.push(reopened);
  expect(new RunBudgets(reopened).status(a.id).allowance!.reserved).toBe(5000);
});
it('P09-I02/P09-I09 BAT-07/BAT-10 does not mix token metrics from different runtimes or claim that missing usage is zero',async()=>{
  const {store,call,a,pool,addRun}=await fixture();const c=await call('profile/create',{name:'Different runtime',provider:'claude',model:'fixture'});
  await expect(call('budget/link',{profileId:c.id,poolId:pool.id,reservation:5000})).rejects.toThrow('distinti');
  const budgets=new RunBudgets(store);const id=addRun(a.id);budgets.reserve(id,a.id);budgets.observe(id,{usage:{tokens:'unknown'}});budgets.finish(id,'finished');
  expect(budgets.status(a.id).allowance!.reserved).toBe(5000);
});

it('P05-I07/P09-I06/P09-I09 BAT-15/BAT-21 keeps previous-cycle reservations after manual renewal and settles late usage only once into its original cycle',async()=>{
  const {store,a,pool,addRun}=await fixture();const budgets=new RunBudgets(store);const run=addRun(a.id);budgets.reserve(run,a.id);
  const original=budgets.status(a.id);const id=crypto.randomUUID(),reset=new Date(Date.now()+3*86400000).toISOString();
  const renewal=budgets.renew(pool.id,id,200000,reset,'New cycle balance entered explicitly');
  expect(budgets.renew(pool.id,id,200000,reset,'New cycle balance entered explicitly')).toEqual(renewal);
  const newDay=budgets.status(a.id);expect(newDay.allowance!.id).not.toBe(original.allowance!.id);expect(newDay.allowance!.assigned).toBe(Math.floor((200000-20000-5000)/4));
  budgets.observe(run,{usage:{total_tokens:3200}});budgets.finish(run,'finished');budgets.finish(run,'finished');
  expect(store.db.prepare('SELECT residual FROM budget_pools WHERE id=?').get(pool.id)).toEqual({residual:200000});
  expect(store.db.prepare('SELECT residual FROM budget_cycles WHERE id=?').get(original.pool!.cycle)).toEqual({residual:96800});
  expect(budgets.status(a.id).allowance!.assigned).toBe(newDay.allowance!.assigned);
  expect(()=>budgets.renew(pool.id,id,999999,reset,'changed')).toThrow('valori diversi');
});

it('P09-I06 BAT-20/BAT-21 preserves an explicit daily override and its reason across restart without changing spent or spending the protected reserve',async()=>{
  const {store,a,pool,addRun}=await fixture();const budgets=new RunBudgets(store);const run=addRun(a.id);budgets.reserve(run,a.id);budgets.observe(run,{totalTokens:3000});budgets.finish(run,'finished');
  const before=budgets.status(a.id);const id=crypto.randomUUID();budgets.overrideToday(a.id,id,60000,'Finish the user-approved verification');
  expect(budgets.status(a.id).allowance!.spent).toBe(3000);expect(budgets.status(a.id).changes).toHaveLength(1);
  expect(()=>budgets.overrideToday(a.id,crypto.randomUUID(),100000,'Beyond protected balance')).toThrow('riserva');
  expect(store.db.prepare('SELECT reserve FROM budget_pools WHERE id=?').get(pool.id)).toEqual({reserve:10000});
  const path=store.directory;store.close();const reopened=new Store(path);stores.push(reopened);const later=new RunBudgets(reopened);expect(later.status(a.id).allowance!.assigned).toBe(60000);
  later.overrideToday(a.id,id,60000,'Finish the user-approved verification');expect(later.status(a.id).changes).toHaveLength(1);expect(later.status(a.id).changes![0]!.payload.previousAssigned).toBe(before.allowance!.assigned);
});

it('P09-I07/P09-I08 BAT-04/BAT-17/BAT-18 exposes expiry as zero and calibrates only seven complete active days in the same metric',async()=>{
  const {store,a,pool}=await fixture();const budgets=new RunBudgets(store);const original=budgets.status(a.id);const cycle=original.pool!.cycle;
  store.db.prepare('UPDATE budget_cycles SET started_at=? WHERE id=?').run('2026-02-01T09:00:00.000Z',cycle);
  store.db.prepare('UPDATE budget_pools SET reset_at=? WHERE id=?').run('2026-03-01T00:00:00.000Z',pool.id);
  for(let d=1;d<=10;d++)store.db.prepare('INSERT INTO allowances VALUES(?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),pool.id,`2026-02-${String(d).padStart(2,'0')}`,cycle,'tokens',9000,d===9?0:d*100,d===10?500:0);
  const status=budgets.status(a.id,new Date('2026-02-11T09:00:00Z'));
  expect(status.calibration!.validDays).toBe(7);expect(status.calibration!.estimate).toBe(500);
  expect(budgets.status(a.id,new Date('2026-03-01T11:00:00Z')).percent).toBe(0);
  expect(budgets.status(a.id,new Date('2026-03-01T11:00:00Z')).expired).toBe(true);
});
