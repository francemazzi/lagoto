import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isFresh, provenance } from './evidence.js';
import { collectEvidence, evaluateGate, type Attestation, type Evidence, type NativeTest, type SmokeFile } from './gate-evaluator.js';
import { compareWithRoadmap, loadManifest, phasesForScope, roadmapRequirementIds } from './gate-manifest.js';
import { realRunsSummary } from './real-runs.js';
import { readXcresultSummary, readXcresultTests } from './xcresult.js';

// Usage: pnpm gate <P00…P16 | v0.1 | v0.2 | all> [--ci] [--ui] [--skip-build]
//  --ci         live and native coverage that cannot run on this machine counts as blocked, not missing; exit 1 only on failures
//  --ui         run the XCUITest suite (pnpm test:ui) instead of reusing build/native-ui.json
//  --skip-build skip the native bundle build for a quick coverage listing; the phase can never pass in this mode
const args = process.argv.slice(2);
const flags = new Set(args.filter(arg => arg.startsWith('--')));
const requested = args.find(arg => !arg.startsWith('--'));
if (!requested || !/^(?:P(?:0\d|1[0-6])|v0\.1|v0\.2|all)$/.test(requested)) throw new Error('Usage: pnpm gate P00…P16 | v0.1 | v0.2 | all [--ci] [--ui] [--skip-build]');
const unknownFlags = [...flags].filter(flag => !['--ci', '--ui', '--skip-build'].includes(flag));
if (unknownFlags.length) throw new Error(`Flag sconosciuti: ${unknownFlags.join(' ')}`);
const ci = flags.has('--ci'), ui = flags.has('--ui'), skipBuild = flags.has('--skip-build');

const manifest = loadManifest();
const roadmapIds = roadmapRequirementIds(readFileSync('ROADMAP.md', 'utf8'));
const coverage = compareWithRoadmap(manifest, roadmapIds);
if (coverage.missingInManifest.length || coverage.unknownInManifest.length)
  throw new Error(`scripts/gate-manifest.json non allineato a ROADMAP.md. Mancanti: ${coverage.missingInManifest.join(', ') || 'nessuno'}. Sconosciuti: ${coverage.unknownInManifest.join(', ') || 'nessuno'}.`);
const phases = phasesForScope(manifest, requested);
const required = roadmapIds.filter(id => phases.includes(id.slice(0, 3)));

const base = join('build/evidence/gates', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(base, { recursive: true });
const metadata = provenance();
const commands: { command: string; status: number | null; log: string }[] = [];
function run(command: string, cliArgs: string[], label: string, timeout = 180000) {
  const result = spawnSync(command, cliArgs, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  const log = `${label}.log`;
  writeFileSync(join(base, log), (result.stdout ?? '') + (result.stderr ?? '') + (result.error?.message ?? ''));
  commands.push({ command: [command, ...cliArgs].join(' '), status: result.status, log });
  console.log(`${label}: ${result.status === 0 ? 'passed' : 'failed'}`);
  return result.status === 0;
}

run('pnpm', ['typecheck'], 'typecheck');
run('pnpm', ['lint'], 'lint');
if (!skipBuild) run('pnpm', ['build'], 'native-bundle-build', 900000);
const reportPath = join(base, 'vitest.json');
const testsPassed = run('pnpm', ['exec', 'vitest', 'run', '--reporter=json', `--outputFile=${reportPath}`], 'deterministic-tests', 900000);
const testReport = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
const nativeResult = join(process.cwd(), base, 'native.xcresult');
const nativePassed = run('xcodebuild', ['test', '-project', 'macos/Lagoto.xcodeproj', '-scheme', 'Lagoto', '-configuration', 'Debug',
  '-derivedDataPath', 'build/Xcode', '-destination', 'platform=macOS,arch=arm64', '-only-testing:LagotoTests',
  '-resultBundlePath', nativeResult, 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', '-quiet'], 'swift-contracts', 900000);
const nativeCounts = nativePassed ? readXcresultSummary(nativeResult) : null;
const swiftUnitTests = nativePassed ? readXcresultTests(nativeResult) : null;

// XCUITest results: run them now (--ui) or reuse build/native-ui.json when it matches the current sources.
if (ui) run('pnpm', ['test:ui'], 'native-ui-tests', 1800000);
let nativeUi: { source: string; tests: NativeTest[]; summary: unknown } | null = null;
if (existsSync('build/native-ui.json')) {
  try {
    const report = JSON.parse(readFileSync('build/native-ui.json', 'utf8'));
    if (report.sourceFingerprint === metadata.sourceFingerprint && Array.isArray(report.tests)) nativeUi = { source: ui ? 'run' : 'reused', tests: report.tests, summary: report.summary ?? null };
  } catch { /* an unreadable report is no report */ }
}
// Native tokens may be satisfied by Swift unit tests or XCUITests; without the Swift unit run there are no native results at all.
const nativeTests: NativeTest[] | null = swiftUnitTests ? [...swiftUnitTests, ...(nativeUi?.tests ?? [])] : null;

// Smoke evidence from build/evidence/*.json, judged fresh against the current sources.
const freshness = { currentFingerprint: metadata.sourceFingerprint, paths: manifest.freshnessPaths };
const smokeCache = new Map<string, SmokeFile>();
function globToRegExp(glob: string) {
  return new RegExp('^' + glob.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
}
const evidenceFiles = existsSync('build/evidence') ? readdirSync('build/evidence').filter(name => name.endsWith('.json')) : [];
function smokes(glob: string): SmokeFile[] {
  const pattern = globToRegExp(glob);
  return evidenceFiles.filter(name => pattern.test(name)).map(name => {
    const cached = smokeCache.get(name);
    if (cached) return cached;
    const path = join('build/evidence', name);
    let file: SmokeFile;
    try {
      const json = JSON.parse(readFileSync(path, 'utf8'));
      file = { path, status: typeof json.status === 'string' ? json.status : 'invalid', fresh: isFresh(json, freshness), date: typeof json.date === 'string' ? json.date : undefined };
    } catch { file = { path, status: 'invalid', fresh: false }; }
    smokeCache.set(name, file);
    return file;
  });
}
function attestations(path: string): Attestation {
  if (!existsSync(path)) return { path, present: false, fresh: false };
  const text = readFileSync(path, 'utf8');
  const outcome = text.match(/^\s*(?:[-*]\s*)?\**Esito\**:\s*\**(passed|blocked|failed)\**/im)?.[1]?.toLowerCase();
  const commit = text.match(/\**Commit\**:\s*`?([0-9a-f]{7,40})`?/i)?.[1];
  return { path, present: true, outcome, fresh: commit ? isFresh({ commit, dirty: false }, freshness) : false };
}

const assertions = (testReport?.testResults ?? []).flatMap((suite: any) => (suite.assertionResults ?? []).map((test: any) => ({ fullName: String(test.fullName ?? ''), status: String(test.status ?? 'unknown') })));
const evidence: Evidence[] = collectEvidence(manifest, required, { assertions, native: nativeTests, smokes, attestations, ci });

const commandsOk = commands.every(command => command.status === 0);
const suiteOk = Boolean(testsPassed && testReport?.numTotalTests && testReport.numPendingTests === 0 && nativePassed && nativeCounts?.total && nativeCounts.failed === 0 && nativeCounts.skipped === 0);
const realRuns = realRunsSummary();
let anyFailed = !commandsOk || !suiteOk;
for (const phase of phases) {
  const ids = required.filter(id => id.startsWith(phase));
  const phaseEvidence = evidence.filter(item => ids.includes(item.id));
  const result = evaluateGate(ids, phaseEvidence);
  const status = !commandsOk || !suiteOk || skipBuild ? 'failed' : result.status;
  if (phaseEvidence.some(item => item.reason?.includes('failed:'))) anyFailed = true;
  const report = {
    ...metadata, scope: requested, phase, ci, ui, skipBuild, ...result, status, commands,
    tests: testReport ? { total: testReport.numTotalTests, passed: testReport.numPassedTests, failed: testReport.numFailedTests, skipped: testReport.numPendingTests } : null,
    nativeCounts, nativeUi: nativeUi ? { source: nativeUi.source, summary: nativeUi.summary } : null, realRuns,
    evidence: phaseEvidence,
    limitations: [
      'A requirement is complete only when every manifest part is satisfied by executed, fresh evidence.',
      'Smokes and attestations produced from other sources are stale and never reused.',
      ...(ci ? ['CI mode: live and native parts that cannot run here are reported as blocked, not passed.'] : []),
      ...(skipBuild ? ['Build skipped: this report lists coverage only and cannot close the phase.'] : []),
    ],
  };
  writeFileSync(join(base, `${phase}.json`), JSON.stringify(report, null, 2));
  const incomplete = phaseEvidence.filter(item => !item.complete || item.status !== 'passed').map(item => `${item.id}[${item.reason ?? item.status}]`);
  console.log(`${phase}: ${status}; incomplete ${incomplete.length}/${ids.length}${incomplete.length ? ': ' + incomplete.join(' ') : ''}`);
  if (!ci && status !== 'passed') process.exitCode = 1;
}
if (ci && anyFailed) process.exitCode = 1;
console.log(`Evidence: ${base}; real runs today ${realRuns.used}/${realRuns.cap}`);
