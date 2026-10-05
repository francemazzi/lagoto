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
    if(!config)return {configured:false,providerQuota:'unknown' as const};
    const days=daysUntilReset(date,new Date(config.reset_at),config.timezone);
    const pending=this.store.db.prepare('SELECT COALESCE(SUM(a.reserved),0) AS total FROM allowances a WHERE a.pool=? AND NOT(a.day=? AND a.cycle=?)').get(config.id,localDate(date,config.timezone),config.cycle) as {total:number};
    const assigned=allowanceAmount(config.residual-pending.total,config.reserve,days);
    const allowance=this.ledger.open(config.id,localDate(date,config.timezone),config.cycle,config.unit,assigned);
    return {configured:true,providerQuota:'unknown' as const,pool:config,allowance,percent:battery(allowance.assigned,allowance.spent,allowance.reserved),expired:days===0};
  }
  reserve(runId:string,profileId:string){
    const status=this.status(profileId);if(!status.configured)return;
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
    return a.assigned-a.spent-a.reserved+own.amount-total<=0;
  }
  finish(runId:string,state:string){
    this.store.db.transaction(()=>{
      const row=this.store.db.prepare('SELECT * FROM run_budgets WHERE run_id=?').get(runId) as {pool_id:string;reported:number|null;settled:number}|undefined;
      // No measured usage or uncertain stop: retain the reservation, including after restart.
      if(!row||row.settled||row.reported===null||state==='unknown')return;
      this.ledger.settle(`run:${runId}`,row.reported);
      this.store.db.prepare('UPDATE budget_pools SET residual=residual-? WHERE id=?').run(row.reported,row.pool_id);
      this.store.db.prepare('UPDATE run_budgets SET settled=1 WHERE run_id=?').run(runId);
    })();
  }
}
