import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { provenance } from './evidence.js';
import { evaluateGate, type Evidence } from './gate-evaluator.js';

const requested = process.argv[2];
if (!requested || !/^(?:P0[0-9]|P1[0-2]|all)$/.test(requested)) throw new Error('Usage: pnpm gate P00…P12 | all');
const phases = requested === 'all' ? Array.from({ length: 13 }, (_, i) => `P${String(i).padStart(2, '0')}`) : [requested];
const roadmap = readFileSync('ROADMAP.md', 'utf8');
const required = [...new Set([...roadmap.matchAll(/\*\*(P\d{2}-I\d{2}):/g)].map(match => match[1]!))];
const base = join('build/evidence/gates', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(base, { recursive: true });
const metadata = provenance();
const commands: { command: string; status: number | null; log: string }[] = [];
function run(command: string, args: string[], label: string) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  const log = `${label}.log`;
  writeFileSync(join(base, log), (result.stdout ?? '') + (result.stderr ?? '') + (result.error?.message ?? ''));
  commands.push({ command: [command, ...args].join(' '), status: result.status, log });
  console.log(`${label}: ${result.status === 0 ? 'passed' : 'failed'}`);
  return result.status === 0;
}
run('pnpm', ['typecheck'], 'typecheck');
run('pnpm', ['build'], 'native-bundle-build');
const reportPath = join(base, 'vitest.json');
const testsPassed = run('pnpm', ['exec', 'vitest', 'run', '--reporter=json', `--outputFile=${reportPath}`], 'deterministic-tests');
const testReport = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
const nativeResult = join(process.cwd(), base, 'native.xcresult');
const nativePassed = run('xcodebuild', ['test', '-project', 'macos/Lagoto.xcodeproj', '-scheme', 'Lagoto', '-configuration', 'Debug',
  '-derivedDataPath', 'build/Xcode', '-destination', 'platform=macOS,arch=arm64', '-only-testing:LagotoTests',
  '-resultBundlePath', nativeResult, 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', '-quiet'], 'swift-contracts');
let nativeCounts: { total: number; passed: number; failed: number; skipped: number } | null = null;
if (nativePassed) {
  const summary = spawnSync('xcrun', ['xcresulttool', 'get', 'test-results', 'summary', '--path', nativeResult, '--format', 'json'], { encoding: 'utf8', timeout: 30000 });
  try {
    const value = JSON.parse(summary.stdout);
    nativeCounts = { total: value.totalTestCount, passed: value.passedTests, failed: value.failedTests, skipped: value.skippedTests };
  } catch { /* A missing/invalid report cannot prove execution. */ }
}

// Register complete coverage only after every scenario in the named requirement exists.
// The current primitive tests deliberately do not close broader Pxx-Inn requirements.
const evidence: Evidence[] = [];
const gateAssertions = testReport?.testResults?.flatMap((suite: any) => suite.assertionResults ?? []).filter((test: any) => test.fullName?.includes('P01-I05')) ?? [];
if (gateAssertions.length) evidence.push({ id: 'P01-I05', status: gateAssertions.every((test: any) => test.status === 'passed') ? 'passed' : 'failed',
  executed: gateAssertions.filter((test: any) => ['passed', 'failed'].includes(test.status)).length,
  skipped: gateAssertions.filter((test: any) => !['passed', 'failed'].includes(test.status)).length,
  complete: false, kind: 'deterministic', reason: 'Gate evaluator covered; fake adapter, CI and end-to-end gate corruption cases remain.' });
for (const phase of phases) {
  const result = evaluateGate(required.filter(id => id.startsWith(phase)), evidence);
  const report = { ...metadata, phase, ...result, status: (!testsPassed || !nativePassed || commands.some(c => c.status !== 0) || !testReport?.numTotalTests || testReport.numPendingTests > 0 || !nativeCounts?.total || nativeCounts.failed > 0 || nativeCounts.skipped > 0) ? 'failed' : result.status,
    commands, tests: testReport ? { total: testReport.numTotalTests, passed: testReport.numPassedTests, failed: testReport.numFailedTests, skipped: testReport.numPendingTests } : null,
    nativeCounts, evidence,
    limitations: ['Partial tests do not close full requirements.', 'Provider smokes are separate real commands; mock evidence is never substituted.', 'XCUITest and Finder acceptance remain mandatory; this command currently runs Swift contract tests only.'],
  };
  writeFileSync(join(base, `${phase}.json`), JSON.stringify(report, null, 2));
  console.log(`${phase}: ${report.status}; required coverage missing: ${result.missing.join(', ') || 'none'}`);
  if (report.status !== 'passed') process.exitCode = 1;
}
console.log(`Evidence: ${base}`);
