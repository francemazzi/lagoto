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
      if (!a || a.assigned - a.spent - a.reserved < amount) throw new AppError(409, 'Budget disponibile insufficiente');
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
