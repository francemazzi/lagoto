import type { Manifest } from './gate-manifest.js';

export type Outcome = 'passed' | 'failed' | 'blocked';
export type EvidenceKind = 'deterministic' | 'native' | 'live';
export type Evidence = {
  id: string; status: Outcome; executed: number; skipped: number; complete: boolean; kind: EvidenceKind;
  /** Machine-readable reasons: missing-test:<token>, missing-scenario:<tag>, missing-native:<token>, missing-native-results, missing-smoke:<glob>, stale-smoke:<glob>, blocked:<glob>, missing-attestation:<path>, stale-attestation:<path>, failed:<what>. */
  reason?: string; details?: string[];
};

/** A component test is not evidence for the whole requirement. */
export function evaluateGate(required: string[], evidence: Evidence[]) {
  const missing = required.filter(id => !evidence.some(item => item.id === id && item.complete));
  const applicable = evidence.filter(item => required.includes(item.id));
  const invalid = applicable.filter(item => item.complete && item.status === 'passed' && (item.executed < 1 || item.skipped > 0));
  const duplicate = required.filter(id => evidence.filter(item => item.id === id && item.complete).length > 1);
  const status: Outcome = !required.length || missing.length || invalid.length || duplicate.length || applicable.some(item => item.status === 'failed')
    ? 'failed' : applicable.some(item => item.status === 'blocked') ? 'blocked' : 'passed';
  return { status, missing, invalid: invalid.map(item => item.id), duplicate };
}

export type TestAssertion = { fullName: string; status: string };
export type NativeTest = { identifier: string; result: string };
export type SmokeFile = { path: string; status: string; fresh: boolean; date?: string | undefined };
export type Attestation = { path: string; present: boolean; outcome?: string | undefined; fresh: boolean };
export type CollectInput = {
  assertions: TestAssertion[];
  /** null when no XCUITest results are available for the current sources. */
  native: NativeTest[] | null;
  smokes: (glob: string) => SmokeFile[];
  attestations: (path: string) => Attestation;
  /** CI mode: missing native/live parts count as blocked instead of missing, so a runner without credentials or a Mac still reports honestly. */
  ci?: boolean;
};

type Part = { ok: boolean; blocked: boolean; failed: boolean; executed: number; skipped: number; reason?: string };

function testPart(tokens: string[], assertions: TestAssertion[], prefix: 'missing-test' | 'missing-scenario'): Part {
  const part: Part = { ok: true, blocked: false, failed: false, executed: 0, skipped: 0 };
  const reasons: string[] = [];
  for (const token of tokens) {
    const matching = assertions.filter(test => test.fullName.includes(token));
    if (!matching.length) { part.ok = false; reasons.push(`${prefix}:${token}`); continue; }
    const executed = matching.filter(test => test.status === 'passed' || test.status === 'failed');
    part.executed += executed.length;
    part.skipped += matching.length - executed.length;
    if (matching.some(test => test.status !== 'passed')) { part.failed = true; reasons.push(`failed:${token}`); }
  }
  if (reasons.length) part.reason = reasons.join(' ');
  return part;
}

function nativePart(tokens: string[], native: NativeTest[] | null): Part {
  const part: Part = { ok: true, blocked: false, failed: false, executed: 0, skipped: 0 };
  if (!tokens.length) return part;
  if (native === null) return { ...part, ok: false, reason: 'missing-native-results' };
  const reasons: string[] = [];
  for (const token of tokens) {
    const matching = native.filter(test => test.identifier.includes(token));
    if (!matching.length) { part.ok = false; reasons.push(`missing-native:${token}`); continue; }
    part.executed += matching.filter(test => test.result === 'Passed' || test.result === 'Failed').length;
    part.skipped += matching.filter(test => test.result !== 'Passed' && test.result !== 'Failed').length;
    if (matching.some(test => test.result !== 'Passed')) { part.failed = true; reasons.push(`failed:${token}`); }
  }
  if (reasons.length) part.reason = reasons.join(' ');
  return part;
}

function smokePart(globs: string[], smokes: CollectInput['smokes']): Part {
  const part: Part = { ok: true, blocked: false, failed: false, executed: 0, skipped: 0 };
  const reasons: string[] = [];
  for (const glob of globs) {
    const files = smokes(glob);
    const fresh = files.filter(file => file.fresh);
    if (fresh.some(file => file.status === 'passed')) { part.executed += 1; continue; }
    if (fresh.some(file => file.status === 'blocked')) { part.blocked = true; reasons.push(`blocked:${glob}`); continue; }
    if (fresh.some(file => file.status === 'failed')) { part.failed = true; reasons.push(`failed:${glob}`); continue; }
    part.ok = false;
    reasons.push(files.length ? `stale-smoke:${glob}` : `missing-smoke:${glob}`);
  }
  if (reasons.length) part.reason = reasons.join(' ');
  return part;
}

function attestationPart(paths: string[], attestations: CollectInput['attestations']): Part {
  const part: Part = { ok: true, blocked: false, failed: false, executed: 0, skipped: 0 };
  const reasons: string[] = [];
  for (const path of paths) {
    const attestation = attestations(path);
    if (!attestation.present) { part.ok = false; reasons.push(`missing-attestation:${path}`); continue; }
    if (attestation.outcome === 'failed') { part.failed = true; reasons.push(`failed:${path}`); continue; }
    if (attestation.outcome === 'blocked') { part.blocked = true; reasons.push(`blocked:${path}`); continue; }
    if (attestation.outcome !== 'passed') { part.ok = false; reasons.push(`missing-attestation:${path}`); continue; }
    if (!attestation.fresh) { part.ok = false; reasons.push(`stale-attestation:${path}`); continue; }
    part.executed += 1;
  }
  if (reasons.length) part.reason = reasons.join(' ');
  return part;
}

/** Build one evidence entry per required requirement from the manifest and the observed results. */
export function collectEvidence(manifest: Manifest, required: string[], input: CollectInput): Evidence[] {
  return required.map(id => {
    const requirement = manifest.requirements[id];
    if (!requirement) return { id, status: 'failed', executed: 0, skipped: 0, complete: false, kind: 'deterministic', reason: 'missing-manifest-entry' } satisfies Evidence;
    const deterministic = [testPart(requirement.tests, input.assertions, 'missing-test'), testPart(requirement.scenarios, input.assertions, 'missing-scenario')];
    const external = [nativePart(requirement.native, input.native), smokePart(requirement.smokes, input.smokes), attestationPart(requirement.attestations, input.attestations)];
    if (input.ci) for (const part of external) if (!part.ok && !part.failed) { part.ok = true; part.blocked = true; }
    const parts = [...deterministic, ...external];
    const failed = parts.some(part => part.failed);
    const incomplete = parts.some(part => !part.ok);
    const blocked = parts.some(part => part.blocked);
    const reasons = parts.map(part => part.reason).filter((reason): reason is string => Boolean(reason));
    return {
      id, kind: requirement.kind,
      executed: parts.reduce((sum, part) => sum + part.executed, 0),
      skipped: parts.reduce((sum, part) => sum + part.skipped, 0),
      complete: !failed && !incomplete,
      status: failed ? 'failed' : incomplete ? 'failed' : blocked ? 'blocked' : 'passed',
      ...(reasons.length ? { reason: reasons.join(' ') } : {}),
    } satisfies Evidence;
  });
}
