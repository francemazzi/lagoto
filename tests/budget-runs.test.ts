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
it('BAT-06/BAT-14 model switches use the same allowance and a duplicate cumulative usage event never charges twice',async()=>{
  const {store,a,b,addRun,pool}=await fixture();const budgets=new RunBudgets(store);const id=addRun(a.id);
  budgets.reserve(id,a.id);budgets.observe(id,{payload:{tokenUsage:{total:{totalTokens:3000}}}});budgets.observe(id,{payload:{tokenUsage:{total:{totalTokens:3000}}}});budgets.finish(id,'finished');budgets.finish(id,'finished');
  const first=budgets.status(a.id),second=budgets.status(b.id);
  expect(first.allowance!.id).toBe(second.allowance!.id);expect(second.allowance!.spent).toBe(3000);expect(second.allowance!.reserved).toBe(0);
  expect((store.db.prepare('SELECT residual,reserve FROM budget_pools WHERE id=?').get(pool.id))).toEqual({residual:97000,reserve:10000});
});
it('BAT-10/BAT-11 keeps uncertain commitments across restart and midnight; zero blocks the next turn',async()=>{
  const {store,a,addRun}=await fixture();const budgets=new RunBudgets(store);const id=addRun(a.id);budgets.reserve(id,a.id);budgets.finish(id,'unknown');
  const today=budgets.status(a.id);const tomorrow=budgets.status(a.id,new Date(Date.now()+86400000));
  expect(today.allowance!.reserved).toBe(5000);expect(tomorrow.allowance!.reserved).toBe(0);
  expect(tomorrow.allowance!.assigned).toBeLessThan(45000);
  store.db.prepare('UPDATE allowances SET spent=assigned WHERE id=?').run(today.allowance!.id);
  const next=addRun(a.id);expect(()=>budgets.reserve(next,a.id)).toThrow('insufficiente');
  const path=store.directory;store.close();const reopened=new Store(path);stores.push(reopened);
  expect(new RunBudgets(reopened).status(a.id).allowance!.reserved).toBe(5000);
});
it('does not mix token metrics from different runtimes or claim that missing usage is zero',async()=>{
  const {store,call,a,pool,addRun}=await fixture();const c=await call('profile/create',{name:'Different runtime',provider:'claude',model:'fixture'});
  await expect(call('budget/link',{profileId:c.id,poolId:pool.id,reservation:5000})).rejects.toThrow('distinti');
  const budgets=new RunBudgets(store);const id=addRun(a.id);budgets.reserve(id,a.id);budgets.observe(id,{usage:{tokens:'unknown'}});budgets.finish(id,'finished');
  expect(budgets.status(a.id).allowance!.reserved).toBe(5000);
});
