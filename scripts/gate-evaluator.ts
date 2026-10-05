export type Outcome = 'passed' | 'failed' | 'blocked';
export type Evidence = { id: string; status: Outcome; executed: number; skipped: number; complete: boolean; kind: 'deterministic' | 'native' | 'live'; reason?: string };

/** A component test is not evidence for the whole requirement. */
export function evaluateGate(required: string[], evidence: Evidence[]) {
  const missing = required.filter(id => !evidence.some(item => item.id === id && item.complete));
  const applicable = evidence.filter(item => required.includes(item.id));
  const invalid = applicable.filter(item => item.complete && (item.executed < 1 || item.skipped > 0));
  const duplicate = required.filter(id => evidence.filter(item => item.id === id && item.complete).length > 1);
  const status: Outcome = !required.length || missing.length || invalid.length || duplicate.length || applicable.some(item => item.status === 'failed')
    ? 'failed' : applicable.some(item => item.status === 'blocked') ? 'blocked' : 'passed';
  return { status, missing, invalid: invalid.map(item => item.id), duplicate };
}
