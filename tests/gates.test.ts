import { describe, it, expect } from 'vitest';
import { evaluateGate, type Evidence } from '../scripts/gate-evaluator.js';

const complete: Evidence = { id: 'P01-I05', kind: 'deterministic', complete: true, executed: 1, skipped: 0, status: 'passed' };
describe('P01-I05 gate failure semantics', () => {
  it('rejects missing requirements and empty suites', () => {
    expect(evaluateGate(['P01-I05'], []).status).toBe('failed');
    expect(evaluateGate([], []).status).toBe('failed');
    expect(evaluateGate(['P01-I05'], [{ ...complete, executed: 0 }]).status).toBe('failed');
  });
  it('rejects skipped tests, duplicate attestations, intentional failures and partial coverage', () => {
    for (const replacement of [{ skipped: 1 }, { status: 'failed' as const }, { complete: false }])
      expect(evaluateGate(['P01-I05'], [{ ...complete, ...replacement }]).status).toBe('failed');
    expect(evaluateGate(['P01-I05'], [complete, complete]).status).toBe('failed');
  });
  it('keeps an unavailable real integration blocked and requires actual executed evidence', () => {
    expect(evaluateGate(['P01-I05'], [{ ...complete, kind: 'live', status: 'blocked' }]).status).toBe('blocked');
    expect(evaluateGate(['P01-I05'], [complete]).status).toBe('passed');
  });
});
