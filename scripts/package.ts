import { execFileSync } from 'node:child_process';
import { mkdirSync, cpSync, symlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { provenance, writeBlocked, writeSmoke } from './evidence.js';
import { inspectBundle } from './package-checks.js';

// Release packaging: DMG, Developer ID signature, notarization, staple, Gatekeeper, SHA-256 and evidence.
// Never tags and never uploads: publishing is a separate explicit step approved by Francesco.
// Usage: LAGOTO_SIGN_IDENTITY=... LAGOTO_NOTARY_PROFILE=... pnpm package   (after `pnpm build --release`)
const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
const identity = process.env.LAGOTO_SIGN_IDENTITY;
const profile = process.env.LAGOTO_NOTARY_PROFILE;
const stamp = new Date().toISOString().replaceAll(':', '-');
if (!identity || !profile) {
  const target = writeBlocked(`package-${version}-${stamp}`, 'LAGOTO_SIGN_IDENTITY o LAGOTO_NOTARY_PROFILE non impostati', { scope: 'Release packaging not attempted' });
  console.log(`blocked: ${target}`); process.exit(2);
}
const run = (command: string, args: string[]) => execFileSync(command, args, { stdio: 'inherit' });
const output = resolve('build/release');
rmSync(output, { recursive: true, force: true });
const stage = join(output, 'stage'); mkdirSync(stage, { recursive: true });
const app = join(stage, 'Lagoto.app');
cpSync('build/Xcode/Build/Products/Release/Lagoto.app', app, { recursive: true, verbatimSymlinks: true });
const checks = inspectBundle(app);
const failed = checks.filter(check => !check.ok);
const buildProvenance = JSON.parse(readFileSync(join(app, 'Contents/Resources/build-provenance.json'), 'utf8'));
const name = `Lagoto-${version}-macos-arm64.dmg`;
const dmg = join(output, name);
let status: 'passed' | 'failed' = 'failed'; let submissionId: string | undefined; let error: string | undefined; let sha256: string | undefined;
try {
  if (failed.length) throw new Error(`Controlli del bundle falliti: ${failed.map(check => check.name).join(', ')}`);
  symlinkSync('/Applications', join(stage, 'Applications'));
  run('codesign', ['--verify', '--deep', '--strict', app]);
  run('hdiutil', ['create', '-volname', `Lagoto ${version}`, '-srcfolder', stage, '-ov', '-format', 'UDZO', dmg]);
  run('codesign', ['--sign', identity!, '--timestamp', dmg]);
  const submission = JSON.parse(execFileSync('xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', profile!, '--wait', '--output-format', 'json'], { encoding: 'utf8', timeout: 1800000 }));
  submissionId = submission.id;
  writeFileSync(join(output, 'notary.json'), JSON.stringify({ id: submission.id, status: submission.status }, null, 2));
  if (submission.status !== 'Accepted') throw new Error(`Notarizzazione ${submission.status}: ispeziona la submission ${submission.id}`);
  for (const target of [app, dmg]) { run('xcrun', ['stapler', 'staple', target]); run('xcrun', ['stapler', 'validate', target]); }
  run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
  sha256 = createHash('sha256').update(readFileSync(dmg)).digest('hex');
  writeFileSync(`${dmg}.sha256`, `${sha256}  ${name}\n`);
  status = 'passed';
} catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
const target = writeSmoke(`package-${version}-${stamp}`, { ...provenance(), buildProvenance, status, version, dmg: name, sha256, submissionId, bundleChecks: checks, error,
  limitations: ['Finder launch on a clean macOS 15 machine, update over a previous version and the redownloaded published artifact are checked separately (P12-I01 attestation)'] });
console.log(JSON.stringify({ status, evidence: target, error }, null, 2));
process.exitCode = status === 'passed' ? 0 : 1;
