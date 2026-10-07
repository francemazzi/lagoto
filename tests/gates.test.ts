import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectEvidence, evaluateGate, type Evidence, type CollectInput } from '../scripts/gate-evaluator.js';
import { compareWithRoadmap, deriveKind, loadManifest, parseManifest, phasesForScope, roadmapRequirementIds, type Manifest } from '../scripts/gate-manifest.js';
import { RealRunCapError, consumeRealRun, realRunsSummary } from '../scripts/real-runs.js';
import { SecretInEvidenceError, findSecrets, isFresh, sourceFingerprint, writeSmoke } from '../scripts/evidence.js';
import { flattenTestNodes } from '../scripts/xcresult.js';

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
    expect(evaluateGate(['P01-I05'], [{ ...complete, kind: 'live', status: 'blocked', executed: 0 }]).status).toBe('blocked');
    expect(evaluateGate(['P01-I05'], [complete]).status).toBe('passed');
  });
});

const manifest: Manifest = {
  version: 1, description: 'test', scopes: { 'v0.1': ['P01'] }, freshnessPaths: ['runtime'],
  requirements: {
    'P01-I01': { kind: 'deterministic', tests: ['P01-I01'], scenarios: [], native: [], smokes: [], attestations: [] },
    'P01-I02': { kind: 'deterministic', tests: ['P01-I02'], scenarios: ['BAT-01'], native: [], smokes: [], attestations: [] },
    'P01-I03': { kind: 'native', tests: ['P01-I03'], scenarios: [], native: ['P01_I03'], smokes: [], attestations: [] },
    'P01-I04': { kind: 'live', tests: ['P01-I04'], scenarios: [], native: [], smokes: ['smoke-x-*.json'], attestations: [] },
    'P01-I05': { kind: 'live', tests: [], scenarios: [], native: [], smokes: [], attestations: ['docs/evidence/x.md'] },
  },
};
const passing = (name: string) => ({ fullName: name, status: 'passed' });
function input(overrides: Partial<CollectInput> = {}): CollectInput {
  return { assertions: [passing('P01-I01 a'), passing('P01-I02 b BAT-01'), passing('P01-I03 c'), passing('P01-I04 d')], native: [{ identifier: 'Suite/testP01_I03_x()', result: 'Passed' }],
    smokes: () => [], attestations: path => ({ path, present: false, fresh: false }), ...overrides };
}

describe('P01-I05 evidence collection from the manifest', () => {
  it('completes a deterministic requirement only when every test token and scenario tag passed', () => {
    const [i01, i02] = collectEvidence(manifest, ['P01-I01', 'P01-I02'], input());
    expect(i01).toMatchObject({ complete: true, status: 'passed', executed: 1 });
    expect(i02).toMatchObject({ complete: true, status: 'passed', executed: 2 });
    const missingScenario = collectEvidence(manifest, ['P01-I02'], input({ assertions: [passing('P01-I02 b')] }))[0]!;
    expect(missingScenario).toMatchObject({ complete: false, status: 'failed', reason: 'missing-scenario:BAT-01' });
    const failing = collectEvidence(manifest, ['P01-I01'], input({ assertions: [{ fullName: 'P01-I01 a', status: 'failed' }] }))[0]!;
    expect(failing).toMatchObject({ complete: false, status: 'failed', reason: 'failed:P01-I01' });
    const skipped = collectEvidence(manifest, ['P01-I01'], input({ assertions: [{ fullName: 'P01-I01 a', status: 'pending' }] }))[0]!;
    expect(skipped).toMatchObject({ complete: false, skipped: 1 });
    expect(evaluateGate(['P01-I01'], [skipped]).status).toBe('failed');
  });
  it('keeps a live requirement incomplete when only mock tests exist, blocked on a blocked smoke and stale on changed sources', () => {
    const mockOnly = collectEvidence(manifest, ['P01-I04'], input())[0]!;
    expect(mockOnly).toMatchObject({ complete: false, reason: 'missing-smoke:smoke-x-*.json' });
    const blocked = collectEvidence(manifest, ['P01-I04'], input({ smokes: () => [{ path: 'a', status: 'blocked', fresh: true }] }))[0]!;
    expect(blocked).toMatchObject({ complete: true, status: 'blocked' });
    expect(evaluateGate(['P01-I04'], [blocked]).status).toBe('blocked');
    const stale = collectEvidence(manifest, ['P01-I04'], input({ smokes: () => [{ path: 'a', status: 'passed', fresh: false }] }))[0]!;
    expect(stale).toMatchObject({ complete: false, reason: 'stale-smoke:smoke-x-*.json' });
    const failed = collectEvidence(manifest, ['P01-I04'], input({ smokes: () => [{ path: 'a', status: 'failed', fresh: true }] }))[0]!;
    expect(failed).toMatchObject({ complete: false, status: 'failed' });
    const passed = collectEvidence(manifest, ['P01-I04'], input({ smokes: () => [{ path: 'a', status: 'passed', fresh: true }, { path: 'old', status: 'failed', fresh: false }] }))[0]!;
    expect(passed).toMatchObject({ complete: true, status: 'passed' });
  });
  it('requires native results for native requirements and attestations with a fresh passed outcome', () => {
    expect(collectEvidence(manifest, ['P01-I03'], input())[0]).toMatchObject({ complete: true, status: 'passed', executed: 2 });
    expect(collectEvidence(manifest, ['P01-I03'], input({ native: null }))[0]).toMatchObject({ complete: false, reason: 'missing-native-results' });
    expect(collectEvidence(manifest, ['P01-I03'], input({ native: [] }))[0]).toMatchObject({ complete: false, reason: 'missing-native:P01_I03' });
    expect(collectEvidence(manifest, ['P01-I03'], input({ native: [{ identifier: 'Suite/testP01_I03_x()', result: 'Failed' }] }))[0]).toMatchObject({ complete: false, status: 'failed' });
    expect(collectEvidence(manifest, ['P01-I05'], input())[0]).toMatchObject({ complete: false, reason: 'missing-attestation:docs/evidence/x.md' });
    expect(collectEvidence(manifest, ['P01-I05'], input({ attestations: path => ({ path, present: true, outcome: 'passed', fresh: false }) }))[0]).toMatchObject({ complete: false, reason: 'stale-attestation:docs/evidence/x.md' });
    expect(collectEvidence(manifest, ['P01-I05'], input({ attestations: path => ({ path, present: true, outcome: 'passed', fresh: true }) }))[0]).toMatchObject({ complete: true, status: 'passed' });
  });
  it('reports unavailable native and live parts as blocked in CI mode, but never a failed or missing deterministic part', () => {
    const ci = collectEvidence(manifest, ['P01-I03', 'P01-I04', 'P01-I01'], input({ native: null, assertions: [passing('P01-I03 c'), passing('P01-I04 d')], ci: true }));
    expect(ci.map(item => item.status)).toEqual(['blocked', 'blocked', 'failed']);
    expect(ci[2]).toMatchObject({ complete: false, reason: 'missing-test:P01-I01' });
    const failedSmoke = collectEvidence(manifest, ['P01-I04'], input({ smokes: () => [{ path: 'a', status: 'failed', fresh: true }], ci: true }))[0]!;
    expect(failedSmoke.status).toBe('failed');
  });
});

describe('P01-I05 manifest integrity', () => {
  it('covers every roadmap requirement exactly once and derives kinds from the lists', () => {
    const real = loadManifest();
    const ids = roadmapRequirementIds(readFileSync('ROADMAP.md', 'utf8'));
    expect(ids.length).toBeGreaterThanOrEqual(117);
    expect(compareWithRoadmap(real, ids)).toEqual({ missingInManifest: [], unknownInManifest: [] });
    expect(phasesForScope(real, 'all')).toHaveLength(17);
    expect(phasesForScope(real, 'v0.1')).toEqual(['P00', 'P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12']);
    expect(deriveKind({ native: [], smokes: ['x'], attestations: [] })).toBe('live');
    expect(() => parseManifest(JSON.stringify({ ...manifest, requirements: { 'P01-I01': { ...manifest.requirements['P01-I01'], kind: 'live' } } }))).toThrow(/kind/);
    expect(() => parseManifest(JSON.stringify({ ...manifest, requirements: { 'P01-I01': { ...manifest.requirements['P01-I01'], tests: [] } } }))).toThrow(/nessuna copertura/);
    expect(() => phasesForScope(real, 'v9')).toThrow(/Scope/);
  });
  it('P01-I01 keeps install, typecheck, lint, build and test scripts with a frozen lockfile', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
    for (const name of ['typecheck', 'lint', 'build', 'test', 'test:ui', 'gate']) expect(scripts[name], name).toBeTruthy();
    expect(existsSync('pnpm-lock.yaml')).toBe(true);
    expect(existsSync('.oxlintrc.json')).toBe(true);
  });
});

describe('P01-I05 real-run cap and evidence hygiene', () => {
  it('counts real runs per day and refuses the run that would exceed the agreed cap', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lagoto-real-runs-'));
    const env = { LAGOTO_REAL_RUN_CAP: '2' };
    const now = new Date('2026-10-07T10:00:00Z');
    expect(consumeRealRun('smoke:a', 1, { directory, env, now })).toEqual({ used: 1, cap: 2, remaining: 1 });
    expect(consumeRealRun('smoke:b', 1, { directory, env, now })).toEqual({ used: 2, cap: 2, remaining: 0 });
    expect(() => consumeRealRun('smoke:c', 1, { directory, env, now })).toThrow(RealRunCapError);
    expect(realRunsSummary({ directory, env, now })).toMatchObject({ date: '2026-10-07', cap: 2, used: 2 });
    expect(consumeRealRun('smoke:d', 1, { directory, env, now: new Date('2026-10-08T10:00:00Z') }).used).toBe(1);
    expect(() => consumeRealRun('x', 1, { directory, env: { LAGOTO_REAL_RUN_CAP: 'dieci' }, now })).toThrow(/intero/);
  });
  it('refuses to write evidence that contains a credential and writes clean reports', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lagoto-evidence-'));
    expect(findSecrets('token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12345 and https://user:pw@example.com')).toEqual(['github token', 'credential url']);
    expect(() => writeSmoke('leak', { status: 'passed', log: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz' }, directory)).toThrow(SecretInEvidenceError);
    expect(existsSync(join(directory, 'leak.json'))).toBe(false);
    const written = writeSmoke('clean', { status: 'passed', tokens: 1234 }, directory);
    expect(JSON.parse(readFileSync(written, 'utf8'))).toEqual({ status: 'passed', tokens: 1234 });
  });
  it('treats evidence as fresh only for identical sources or a clean, unchanged commit', () => {
    const current = sourceFingerprint(['package.json']);
    expect(isFresh({ sourceFingerprint: current }, { currentFingerprint: current, paths: ['runtime'] })).toBe(true);
    expect(isFresh({ sourceFingerprint: 'other', dirty: true, commit: 'abcdef1' }, { currentFingerprint: current, paths: ['runtime'] })).toBe(false);
    expect(isFresh({ commit: 'not-a-sha' }, { currentFingerprint: current, paths: ['runtime'] })).toBe(false);
    expect(isFresh({ commit: '0000000000000000000000000000000000000000' }, { currentFingerprint: current, paths: ['runtime'] })).toBe(false);
  });
  it('flattens xcresult test nodes into identifiers and results', () => {
    const tree = { testNodes: [{ nodeType: 'Test Plan', children: [{ nodeType: 'Test Suite', name: 'S', children: [
      { nodeType: 'Test Case', nodeIdentifier: 'S/testP02_I07_x()', result: 'Passed' }, { nodeType: 'Test Case', nodeIdentifier: 'S/testOther()', result: 'Failed' }] }] }] };
    expect(flattenTestNodes(tree)).toEqual([{ identifier: 'S/testP02_I07_x()', result: 'Passed' }, { identifier: 'S/testOther()', result: 'Failed' }]);
    const temporary = mkdtempSync(join(tmpdir(), 'lagoto-xcresult-'));
    writeFileSync(join(temporary, 'ignored.txt'), 'x');
    expect(flattenTestNodes({})).toEqual([]);
  });
});
