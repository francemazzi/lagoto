import { randomUUID } from 'node:crypto';
import { Store } from './storage.js';
import { AppError, now } from './protocol.js';

// Amounts use integer micro-units of one declared metric; different metrics never mix.
export function allowanceAmount(residual: number, reserve: number, days: number) {
  if (![residual, reserve, days].every(Number.isSafeInteger) || reserve < 0 || days < 0) throw new AppError(400, 'Valori budget non validi');
  return days === 0 ? 0 : Math.floor(Math.max(0, residual - reserve) / days);
}
export function battery(assigned: number, spent: number, reserved: number) { return assigned <= 0 ? 0 : Math.max(0, Math.min(100, 100 * (assigned - spent - reserved) / assigned)); }
export function localDate(date: Date, timezone = 'Europe/Rome') { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
export function daysUntilReset(date: Date, reset: Date, timezone = 'Europe/Rome') {
  if (reset <= date) return 0;
  const first = Date.parse(localDate(date, timezone) + 'T00:00:00Z');
  const last = Date.parse(localDate(new Date(reset.getTime() - 1), timezone) + 'T00:00:00Z');
  return Math.round((last - first) / 86400000) + 1;
}
export function calibratedBaseline(samples: { amount: number; complete: boolean }[]) {
  const valid = samples.filter(s => s.complete && s.amount > 0).slice(-7).map(s => s.amount).sort((a, b) => a - b);
  return valid.length === 7 ? valid[3]! : null;
}
type Allowance = { id: string; pool: string; day: string; cycle: string; unit: string; assigned: number; spent: number; reserved: number };
export class BudgetLedger {
  constructor(private store: Store) {}
  open(pool: string, day: string, cycle: string, unit: string, assigned: number): Allowance {
    if (!Number.isSafeInteger(assigned) || assigned < 0) throw new AppError(400, 'Assegnazione invalida');
    this.store.db.prepare('INSERT OR IGNORE INTO allowances(id,pool,day,cycle,unit,assigned) VALUES(?,?,?,?,?,?)').run(randomUUID(), pool, day, cycle, unit, assigned);
    const allowance = this.store.db.prepare('SELECT * FROM allowances WHERE pool=? AND day=? AND cycle=?').get(pool, day, cycle) as Allowance;
    if (allowance.unit !== unit) throw new AppError(400, 'Unità incompatibili'); return allowance;
  }
  reserve(id: string, amount: number, key: string) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new AppError(400, 'Prenotazione invalida');
    return this.store.db.transaction(() => {
      const previous = this.store.db.prepare('SELECT * FROM ledger WHERE source_key=?').get(key) as { allowance_id: string; amount: number } | undefined;
      if (previous) { if (previous.allowance_id !== id || previous.amount !== amount) throw new AppError(409, 'Chiave idempotente riutilizzata con dati diversi'); return previous; }
      const a = this.store.db.prepare('SELECT * FROM allowances WHERE id=?').get(id) as Allowance | undefined;
      if (!a || a.assigned - a.spent - a.reserved <= 0 || a.assigned - a.spent - a.reserved < amount) throw new AppError(409, 'Budget disponibile insufficiente');
      this.store.db.prepare('UPDATE allowances SET reserved=reserved+? WHERE id=?').run(amount, id);
      this.store.db.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?)').run(randomUUID(), id, 'reservation', amount, key, now()); return { allowance_id: id, amount };
    }).immediate();
  }
  settle(key: string, cost: number) {
    if (!Number.isSafeInteger(cost) || cost < 0) throw new AppError(400, 'Costo invalido');
    this.store.db.transaction(() => {
      const old = this.store.db.prepare('SELECT * FROM ledger WHERE source_key=?').get(key) as { allowance_id: string; amount: number; kind: string } | undefined;
      if (!old || old.kind !== 'reservation') throw new AppError(404, 'Prenotazione non trovata');
      const prior = this.store.db.prepare('SELECT amount FROM ledger WHERE source_key=?').get(`settle:${key}`) as { amount: number } | undefined;
      if (prior) { if (prior.amount !== cost) throw new AppError(409, 'Esito diverso per la stessa prenotazione'); return; }
      this.store.db.prepare('UPDATE allowances SET reserved=reserved-?,spent=spent+? WHERE id=?').run(old.amount, cost, old.allowance_id);
      this.store.db.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?)').run(randomUUID(), old.allowance_id, 'charge', cost, `settle:${key}`, now());
    }).immediate();
  }
}

type Pool={id:string;name:string;residual:number;reserve:number;reset_at:string;cycle:string;unit:string;timezone:string};
/** A personal token budget, never a claim about a subscription's actual provider quota. */
export class RunBudgets {
  private ledger:BudgetLedger;
  constructor(private store:Store){this.ledger=new BudgetLedger(store);}
  status(profileId:string,date=new Date()){
    const config=this.store.db.prepare('SELECT p.*,pp.reservation FROM budget_pools p JOIN profile_pools pp ON pp.pool_id=p.id WHERE pp.profile_id=?').get(profileId) as (Pool&{reservation:number})|undefined;
    if(!config){const profile=this.store.db.prepare('SELECT provider FROM profiles WHERE id=?').get(profileId) as {provider:string}|undefined;
      // No pool: a local model is available without a plafond, a cloud model is still calibrating. Never an invented 100%.
      return {configured:false as const,providerQuota:'unknown' as const,availability:(profile?.provider==='ollama'?'local':'calibrating') as 'local'|'calibrating'};}
    const days=daysUntilReset(date,new Date(config.reset_at),config.timezone);
    const pending=this.store.db.prepare('SELECT COALESCE(SUM(a.reserved),0) AS total FROM allowances a WHERE a.pool=? AND NOT(a.day=? AND a.cycle=?)').get(config.id,localDate(date,config.timezone),config.cycle) as {total:number};
    const assigned=allowanceAmount(config.residual-pending.total,config.reserve,days);
    const allowance=this.ledger.open(config.id,localDate(date,config.timezone),config.cycle,config.unit,assigned);
    const samples=this.store.db.prepare("SELECT a.day,a.spent,a.reserved,c.started_at,c.reset_at,(SELECT MIN(ch.created_at) FROM budget_changes ch WHERE ch.kind='renew' AND json_extract(ch.payload,'$.previousCycle')=c.id) AS renewed_at FROM allowances a JOIN budget_cycles c ON c.id=a.cycle WHERE a.pool=? AND a.day<? ORDER BY a.day").all(config.id,localDate(date,config.timezone)) as {day:string;spent:number;reserved:number;started_at:string|null;reset_at:string;renewed_at:string|null}[];
    const calibration=samples.map(s=>{
      const end=new Date(Math.min(Date.parse(s.reset_at),s.renewed_at?Date.parse(s.renewed_at):Infinity));
      return {amount:s.spent,complete:s.reserved===0&&Boolean(s.started_at)&&s.day>localDate(new Date(s.started_at!),config.timezone)&&s.day<localDate(end,config.timezone)};
    });
    const startedAt=(this.store.db.prepare('SELECT started_at FROM budget_cycles WHERE id=?').get(config.cycle) as {started_at:string}|undefined)?.started_at;
    const segment=startedAt&&localDate(new Date(startedAt),config.timezone)===allowance.day?'first-day-partial':'full-day';
    return {configured:true as const,providerQuota:'unknown' as const,availability:'budget' as const,segment,pool:config,allowance,percent:days===0?0:battery(allowance.assigned,allowance.spent,allowance.reserved),expired:days===0,
      alerts:(this.store.db.prepare('SELECT threshold FROM budget_alerts WHERE allowance_id=? ORDER BY threshold DESC').all(allowance.id) as {threshold:number}[]).map(row=>row.threshold),
      calibration:{estimate:calibratedBaseline(calibration),validDays:calibration.filter(s=>s.complete&&s.amount>0).length,scope:'Lagoto · stessa unità e pool'},
      changes:(this.store.db.prepare('SELECT * FROM budget_changes WHERE pool_id=? ORDER BY created_at DESC LIMIT 20').all(config.id) as {payload:string}[]).map(row=>({...row,payload:JSON.parse(row.payload)}))};
  }
  reserve(runId:string,profileId:string,date=new Date()){
    const status=this.status(profileId,date);if(!status.configured)return;
    if(status.expired)throw new AppError(409,'Il ciclo del budget personale è scaduto: aggiorna il residuo');
    this.ledger.reserve(status.allowance!.id,status.pool!.reservation,`run:${runId}`);
    this.store.db.prepare('INSERT INTO run_budgets(run_id,pool_id,allowance_id) VALUES(?,?,?)').run(runId,status.pool!.id,status.allowance!.id);
  }
  observe(runId:string,payload:any){
    const row=this.store.db.prepare('SELECT * FROM run_budgets WHERE run_id=?').get(runId) as {reported:number|null;settled:number;allowance_id:string}|undefined;
    if(!row||row.settled)return false;
    const raw=payload.payload??payload;
    const u=raw.tokenUsage?.total??raw.usage??raw;
    const value=u.totalTokens??u.total_tokens??(typeof u.input_tokens==='number' && typeof u.output_tokens==='number'
      ? u.input_tokens+u.output_tokens+(u.cache_read_input_tokens??0)+(u.cache_creation_input_tokens??0):undefined);
    if(!Number.isSafeInteger(value)||value<0)return false;
    const total=Math.max(row.reported??0,value);
    this.store.db.prepare('UPDATE run_budgets SET reported=? WHERE run_id=?').run(total,runId);
    const a=this.store.db.prepare('SELECT * FROM allowances WHERE id=?').get(row.allowance_id) as Allowance;
    const own=this.store.db.prepare('SELECT amount FROM ledger WHERE source_key=?').get(`run:${runId}`) as {amount:number};
    const remaining=a.assigned-a.spent-a.reserved+own.amount-total;
    // Warnings at 20%, 10% and 0% of today's assignment, once each. The stop decision uses the precise value, not a rounded one.
    if(a.assigned>0){
      const percent=100*remaining/a.assigned;
      for(const threshold of [20,10,0] as const){
        if((threshold===0?remaining<=0:percent<=threshold)&&this.store.db.prepare('INSERT OR IGNORE INTO budget_alerts VALUES(?,?,?)').run(row.allowance_id,threshold,now()).changes){
          const profile=(this.store.db.prepare('SELECT r.profile_id FROM runs r WHERE r.id=?').get(runId) as {profile_id:string}|undefined)?.profile_id;
          this.store.publish('budget_threshold',{profileId:profile,threshold,allowanceId:row.allowance_id});
        }
      }
    }
    return remaining<=0;
  }
  /** Mean of today's personal batteries over enabled profiles that have a numeric budget (P09.10). Never sums units. */
  summary(date=new Date()){
    const rows=this.store.db.prepare('SELECT id,name,provider FROM profiles WHERE enabled=1 ORDER BY name,id').all() as {id:string;name:string;provider:string}[];
    const profiles:{profileId:string;name:string;provider:string;percent:number;pool:string}[]=[];
    const excluded:{profileId:string;name:string;reason:'no-budget'|'local'|'expired'}[]=[];
    for(const row of rows){
      const status=this.status(row.id,date);
      if(!status.configured){excluded.push({profileId:row.id,name:row.name,reason:status.availability==='local'?'local':'no-budget'});continue;}
      if(status.expired){excluded.push({profileId:row.id,name:row.name,reason:'expired'});continue;}
      profiles.push({profileId:row.id,name:row.name,provider:row.provider,percent:status.percent,pool:status.pool.id});
    }
    const average=profiles.length?profiles.reduce((sum,entry)=>sum+entry.percent,0)/profiles.length:null;
    const lowest=profiles.reduce<typeof profiles[number]|null>((best,entry)=>!best||entry.percent<best.percent?entry:best,null);
    return {average,count:profiles.length,lowest,profiles,excluded,scope:'Media delle percentuali di oggi dei profili abilitati con budget numerico; unità e pool non vengono sommati'};
  }
  finish(runId:string,state:string){
    this.store.db.transaction(()=>{
      const row=this.store.db.prepare('SELECT rb.*,a.cycle FROM run_budgets rb JOIN allowances a ON a.id=rb.allowance_id WHERE run_id=?').get(runId) as {pool_id:string;reported:number|null;settled:number;cycle:string}|undefined;
      // No measured usage or uncertain stop: retain the reservation, including after restart.
      if(!row||row.settled||row.reported===null||state==='unknown')return;
      this.ledger.settle(`run:${runId}`,row.reported);
      this.store.db.prepare('UPDATE budget_cycles SET residual=residual-? WHERE id=?').run(row.reported,row.cycle);
      // Late usage settles the personal commitment's original cycle, never a newly supplied balance.
      this.store.db.prepare('UPDATE budget_pools SET residual=residual-? WHERE id=? AND cycle=?').run(row.reported,row.pool_id,row.cycle);
      this.store.db.prepare('UPDATE run_budgets SET settled=1 WHERE run_id=?').run(runId);
    })();
  }
  /**
   * Reconcile an account-level cumulative snapshot with local usage (BAT-08, BAT-09, BAT-10).
   * Local usage is never added on top of a snapshot that already contains it; consumption that cannot be tied
   * to today is reduced from the pool and declared unattributed with partial coverage.
   */
  reconcileSnapshot(poolId:string,cumulative:number,observedAt:Date,options:{source?:string;metric?:string;date?:Date}={}){
    const date=options.date??new Date(),source=options.source??'account',metric=options.metric??'tokens';
    if(!Number.isSafeInteger(cumulative)||cumulative<0||Number.isNaN(observedAt.getTime()))throw new AppError(400,'Snapshot di consumo non valido');
    if(observedAt.getTime()>date.getTime()+60000)throw new AppError(400,'Snapshot dal futuro rifiutato');
    if(date.getTime()-observedAt.getTime()>15*60*1000)return {state:'stale' as const,applied:false};
    const pool=this.store.db.prepare('SELECT * FROM budget_pools WHERE id=?').get(poolId) as Pool|undefined;if(!pool)throw new AppError(404,'Pool non trovato');
    return this.store.db.transaction(()=>{
      const previous=this.store.db.prepare('SELECT * FROM usage_snapshots WHERE pool_id=? AND cycle=? AND metric=? AND source=? ORDER BY observed_at DESC,rowid DESC LIMIT 1').get(poolId,pool.cycle,metric,source) as {cumulative:number;observed_at:string}|undefined;
      const id=randomUUID();
      if(!previous){
        this.store.db.prepare('INSERT INTO usage_snapshots(id,pool_id,cycle,metric,source,cumulative,observed_at,coverage) VALUES(?,?,?,?,?,?,?,?)').run(id,poolId,pool.cycle,metric,source,cumulative,observedAt.toISOString(),'baseline');
        return {state:'baseline' as const,applied:false};
      }
      if(cumulative<previous.cumulative)throw new AppError(409,'Snapshot non coerente con il precedente: contatore diminuito, nessuna spesa dedotta');
      if(observedAt.toISOString()<previous.observed_at)throw new AppError(409,'Snapshot più vecchio del precedente');
      const delta=cumulative-previous.cumulative;
      const local=(this.store.db.prepare("SELECT COALESCE(SUM(l.amount),0) AS total FROM ledger l JOIN allowances a ON a.id=l.allowance_id WHERE a.pool=? AND a.cycle=? AND l.kind='charge' AND l.created_at>? AND l.created_at<=?").get(poolId,pool.cycle,previous.observed_at,observedAt.toISOString()) as {total:number}).total;
      const external=Math.max(0,delta-local);
      const today=localDate(date,pool.timezone);
      const attributable=external>0&&localDate(new Date(previous.observed_at),pool.timezone)===today&&localDate(observedAt,pool.timezone)===today;
      const allowance=attributable?this.store.db.prepare('SELECT * FROM allowances WHERE pool=? AND day=? AND cycle=?').get(poolId,today,pool.cycle) as Allowance|undefined:undefined;
      const attributed=attributable&&allowance?external:0;
      const coverage=external===0||attributed===external?'complete':'partial';
      this.store.db.prepare('INSERT INTO usage_snapshots(id,pool_id,cycle,metric,source,cumulative,observed_at,local_spent,external,attributed,coverage) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,poolId,pool.cycle,metric,source,cumulative,observedAt.toISOString(),local,external,attributed,coverage);
      if(external>0){
        this.store.db.prepare('UPDATE budget_pools SET residual=MAX(0,residual-?) WHERE id=?').run(external,poolId);
        this.store.db.prepare('UPDATE budget_cycles SET residual=MAX(0,residual-?) WHERE id=?').run(external,pool.cycle);
        if(attributed&&allowance){
          this.store.db.prepare('UPDATE allowances SET spent=spent+? WHERE id=?').run(attributed,allowance.id);
          this.store.db.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?)').run(randomUUID(),allowance.id,'external',attributed,`external:${id}`,now());
        }else{
          this.store.db.prepare('INSERT INTO budget_changes VALUES(?,?,?,?,?)').run(randomUUID(),poolId,'external_unattributed',JSON.stringify({amount:external,from:previous.observed_at,to:observedAt.toISOString(),coverage:'partial',scope:'Consumo esterno non attribuibile a una sola giornata: ridotto il saldo, assegnazione odierna invariata'}),now());
        }
      }
      return {state:'applied' as const,applied:true,delta,local,external,attributed,coverage:coverage as 'complete'|'partial'};
    }).immediate();
  }
  renew(poolId:string,id:string,residual:number,resetAt:string,reason:string,date=new Date()){
    if(!Number.isSafeInteger(residual)||residual<0||!Number.isFinite(Date.parse(resetAt))||new Date(resetAt)<=date||!reason.trim())throw new AppError(400,'Rinnovo budget non valido');
    return this.store.db.transaction(()=>{
      const input={poolId,residual,resetAt,reason};const old=this.store.db.prepare('SELECT * FROM budget_changes WHERE id=?').get(id) as {kind:string;payload:string}|undefined;
      if(old){const change=JSON.parse(old.payload);if(old.kind!=='renew'||JSON.stringify(change.input)!==JSON.stringify(input))throw new AppError(409,'Rinnovo riutilizzato con valori diversi');return change;}
      const pool=this.store.db.prepare('SELECT * FROM budget_pools WHERE id=?').get(poolId) as Pool|undefined;if(!pool)throw new AppError(404,'Budget non trovato');
      const cycle=randomUUID(),reserve=Math.ceil(residual/10);
      this.store.db.prepare('INSERT INTO budget_cycles VALUES(?,?,?,?,?,?)').run(cycle,poolId,residual,reserve,resetAt,date.toISOString());
      this.store.db.prepare('UPDATE budget_pools SET residual=?,reserve=?,reset_at=?,cycle=? WHERE id=?').run(residual,reserve,resetAt,cycle,poolId);
      const change={input,previousCycle:pool.cycle,cycle,previousResidual:pool.residual,scope:'Saldo personale del nuovo ciclo; impegni precedenti trattenuti fino alla misura'};
      this.store.db.prepare('INSERT INTO budget_changes VALUES(?,?,?,?,?)').run(id,poolId,'renew',JSON.stringify(change),date.toISOString());return change;
    }).immediate();
  }
  overrideToday(profileId:string,id:string,assigned:number,reason:string,date=new Date()){
    if(!Number.isSafeInteger(assigned)||assigned<0||!reason.trim())throw new AppError(400,'Deroga non valida');
    return this.store.db.transaction(()=>{
      const input={profileId,assigned,reason,day:localDate(date)};const old=this.store.db.prepare('SELECT * FROM budget_changes WHERE id=?').get(id) as {kind:string;payload:string}|undefined;
      if(old){const change=JSON.parse(old.payload);if(old.kind!=='override'||JSON.stringify(change.input)!==JSON.stringify(input))throw new AppError(409,'Deroga riutilizzata con valori diversi');return change;}
      const status=this.status(profileId,date);if(!status.configured||status.expired)throw new AppError(409,'Configura o rinnova prima il budget');
      const a=status.allowance!,pool=status.pool!;
      const other=this.store.db.prepare('SELECT COALESCE(SUM(reserved),0) AS total FROM allowances WHERE pool=? AND id<>?').get(pool.id,a.id) as {total:number};
      if(assigned>a.spent+Math.max(0,pool.residual-pool.reserve-other.total))throw new AppError(409,'La deroga supera il saldo disponibile protetto dalla riserva');
      const change={input,cycle:pool.cycle,allowanceId:a.id,previousAssigned:a.assigned,assigned};
      this.store.db.prepare('UPDATE allowances SET assigned=? WHERE id=?').run(assigned,a.id);
      this.store.db.prepare('INSERT INTO budget_changes VALUES(?,?,?,?,?)').run(id,pool.id,'override',JSON.stringify(change),date.toISOString());return change;
    }).immediate();
  }
}
