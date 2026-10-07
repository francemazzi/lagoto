import type Database from 'better-sqlite3';
import { RunBudgets } from './budget.js';
import { classifyFailure } from './errors.js';

/**
 * One honest label per profile, with the action to take. A positive budget never makes a blocked provider look ready,
 * and a missing budget never hides that a profile is unverified (P02.4).
 */
export type ProfileStateKey = 'ready' | 'ready-local' | 'calibrating' | 'unverified' | 'verifying' | 'verification-failed' | 'auth-needed'
  | 'provider-limit' | 'credit-exhausted' | 'budget-renew' | 'budget-exhausted' | 'run-lost' | 'checkpoint-failed' | 'disabled';
export type ProfileState = { profileId: string; key: ProfileStateKey; label: string; action: string | null; ready: boolean; percent: number | null; tone: 'ok' | 'info' | 'warning' | 'blocked' };

const RECENT_MS = 6 * 3600 * 1000;
const state = (profileId: string, key: ProfileStateKey, label: string, action: string | null, ready: boolean, tone: ProfileState['tone'], percent: number | null = null): ProfileState => ({ profileId, key, label, action, ready, percent, tone });

export function profileStates(db: Database.Database, budgets: RunBudgets, now = new Date()): ProfileState[] {
  const profiles = db.prepare('SELECT id,provider,enabled,capabilities FROM profiles ORDER BY provider,name').all() as { id: string; provider: string; enabled: number; capabilities: string }[];
  return profiles.map(profile => {
    if (!profile.enabled) return state(profile.id, 'disabled', 'Disattivato', 'Riattiva il profilo per usarlo', false, 'blocked');
    const capabilities = JSON.parse(profile.capabilities) as { verification?: string; modes?: string[]; proof?: { message?: string } };
    if (capabilities.verification === 'checking') return state(profile.id, 'verifying', 'Verifica in corso', null, false, 'info');
    if (capabilities.verification === 'failed') {
      const cause = classifyFailure(capabilities.proof?.message).cause;
      return cause === 'auth' ? state(profile.id, 'auth-needed', 'Accesso da rinnovare', 'Rinnova l’accesso, poi verifica di nuovo', false, 'blocked')
        : state(profile.id, 'verification-failed', 'Verifica non riuscita', 'Apri i dettagli e verifica di nuovo', false, 'blocked');
    }
    if (capabilities.verification !== 'passed' || !capabilities.modes?.length) return state(profile.id, 'unverified', 'Da verificare', 'Verifica la connessione del profilo', false, 'warning');
    const last = db.prepare('SELECT id,state,created_at FROM runs WHERE profile_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(profile.id) as { id: string; state: string; created_at: string } | undefined;
    if (last?.state === 'unknown') return state(profile.id, 'run-lost', 'Esecuzione da riconciliare', 'Riconcilia i processi dopo il riavvio', false, 'blocked');
    if (last) {
      const finished = db.prepare("SELECT payload,created_at FROM events WHERE run_id=? AND kind='run_state' ORDER BY seq DESC LIMIT 1").get(last.id) as { payload: string; created_at: string } | undefined;
      const payload = finished ? JSON.parse(finished.payload) as { state?: string; cause?: string } : undefined;
      const recent = finished && now.getTime() - Date.parse(finished.created_at) < RECENT_MS;
      if (recent && payload?.state === 'failed' && payload.cause === 'quota') return state(profile.id, 'provider-limit', 'Limite del provider raggiunto', 'Attendi il reset o scegli un altro modello', false, 'blocked');
      if (recent && payload?.state === 'failed' && payload.cause === 'credit') return state(profile.id, 'credit-exhausted', 'Credito del provider esaurito', 'Ricarica il credito o scegli un altro modello', false, 'blocked');
      if (recent && payload?.state === 'failed' && payload.cause === 'auth') return state(profile.id, 'auth-needed', 'Accesso da rinnovare', 'Rinnova l’accesso, poi verifica di nuovo', false, 'blocked');
      if (db.prepare("SELECT 1 FROM events WHERE run_id=? AND kind='error' AND payload LIKE '%Checkpoint non salvato%' LIMIT 1").get(last.id)) return state(profile.id, 'checkpoint-failed', 'Checkpoint da ripetere', 'Salva un checkpoint prima di cambiare modello', true, 'warning');
    }
    const budget = budgets.status(profile.id, now);
    if (!budget.configured) return budget.availability === 'local'
      ? state(profile.id, 'ready-local', 'Locale · disponibile', null, true, 'ok')
      : state(profile.id, 'calibrating', 'In calibrazione', 'Imposta un budget personale o attendi la calibrazione', true, 'info');
    if (budget.expired) return state(profile.id, 'budget-renew', 'Budget da rinnovare', 'Inserisci il residuo del nuovo ciclo', false, 'blocked', 0);
    if (budget.percent <= 0) return state(profile.id, 'budget-exhausted', 'Budget di oggi esaurito', 'Scegli un altro modello, una deroga per oggi o resta in pausa', false, 'blocked', 0);
    const rounded = budget.percent < 1 ? '<1%' : `${Math.floor(budget.percent)}%`;
    return state(profile.id, 'ready', `Pronto · ${rounded} oggi`, null, true, 'ok', budget.percent);
  });
}
