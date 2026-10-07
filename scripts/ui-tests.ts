import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { provenance } from './evidence.js';
import { readXcresultSummary, readXcresultTests } from './xcresult.js';

// Runs the XCUITest target against the app built by `pnpm build` (the runtime must already be inside the bundle)
// and records every test case with its result in build/native-ui.json, fingerprinted against the current sources
// so `pnpm gate` can reuse it only while nothing changed.
const resultPath = resolve('build/native-ui.xcresult');
rmSync(resultPath, { recursive: true, force: true });
const env = { ...process.env };
// Every run starts from a fresh seeded archive: real Git repositories, worktrees with changes, profiles in every state and transcripts replayed from captured protocols.
const fixtureDir = resolve('build/ui-fixture');
rmSync(fixtureDir, { recursive: true, force: true });
const seed = spawnSync('pnpm', ['seed:ui', fixtureDir], { encoding: 'utf8', timeout: 300000 });
if (seed.status !== 0) { console.error(seed.stdout, seed.stderr); throw new Error('Archivio di prova non creato'); }
env.TEST_RUNNER_LAGOTO_UI_FIXTURE = join(fixtureDir, 'data');
const xcodebuild = spawnSync('xcodebuild', ['test', '-project', 'macos/Lagoto.xcodeproj', '-scheme', 'Lagoto', '-configuration', 'Debug',
  '-derivedDataPath', 'build/Xcode', '-destination', 'platform=macOS,arch=arm64', '-only-testing:LagotoUITests',
  '-parallel-testing-enabled', 'NO', '-test-timeouts-enabled', 'YES', '-maximum-test-execution-time-allowance', '180',
  '-resultBundlePath', resultPath, 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', '-quiet'], { stdio: 'inherit', timeout: 1800000, env });
const tests = readXcresultTests(resultPath) ?? [];
const summary = readXcresultSummary(resultPath);
const status = xcodebuild.status === 0 && summary && summary.total > 0 && summary.failed === 0 && summary.skipped === 0 ? 'passed' : 'failed';
const report = { ...provenance(), status, xcodebuildStatus: xcodebuild.status, summary, tests };
mkdirSync('build', { recursive: true });
writeFileSync('build/native-ui.json', JSON.stringify(report, null, 2));
console.log(`XCUITest: ${status}; ${tests.length} test cases; ${tests.filter(test => test.result === 'Passed').length} passed`);
process.exitCode = status === 'passed' ? 0 : 1;
