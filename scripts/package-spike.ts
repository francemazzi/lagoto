import { execFileSync } from 'node:child_process';
import { mkdirSync, cpSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { provenance } from './evidence.js';

// This is P00 packaging evidence. It never tags, uploads to GitHub or marks a beta ready.
const identity = process.env.LAGOTO_SIGN_IDENTITY;
const profile = process.env.LAGOTO_NOTARY_PROFILE;
if (!identity || !profile) throw new Error('Set LAGOTO_SIGN_IDENTITY and LAGOTO_NOTARY_PROFILE');
const run = (command: string, args: string[]) => execFileSync(command, args, { stdio: 'inherit' });
const output = resolve('build', `spike-${new Date().toISOString().replaceAll(':', '-')}`);
const stage = join(output, 'stage'); mkdirSync(stage, { recursive: true });
const app = join(stage, 'Lagoto.app');
cpSync('build/Xcode/Build/Products/Release/Lagoto.app', app, { recursive: true, verbatimSymlinks: true });
const buildProvenance=JSON.parse(readFileSync(join(app,'Contents/Resources/build-provenance.json'),'utf8'));
symlinkSync('/Applications', join(stage, 'Applications'));
run('codesign', ['--verify', '--deep', '--strict', app]);
const dmg = join(output, 'Lagoto-P00-spike-macos-arm64.dmg');
run('hdiutil', ['create', '-volname', 'Lagoto P00 spike', '-srcfolder', stage, '-ov', '-format', 'UDZO', dmg]);
run('codesign', ['--sign', identity, '--timestamp', dmg]);
const submission = JSON.parse(execFileSync('xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', profile, '--wait', '--output-format', 'json'], { encoding: 'utf8', timeout: 1800000 }));
writeFileSync(join(output, 'notary.json'), JSON.stringify(submission, null, 2));
if (submission.status !== 'Accepted') throw new Error(`Notarization ${submission.status}; inspect submission ${submission.id}`);
run('xcrun', ['stapler', 'staple', app]);
run('xcrun', ['stapler', 'validate', app]);
run('xcrun', ['stapler', 'staple', dmg]);
run('xcrun', ['stapler', 'validate', dmg]);
run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
const sha256 = createHash('sha256').update(readFileSync(dmg)).digest('hex');
writeFileSync(`${dmg}.sha256`, `${sha256}  Lagoto-P00-spike-macos-arm64.dmg\n`);
writeFileSync(join(output, 'evidence.json'), JSON.stringify({ ...provenance(), buildProvenance, status: 'passed', scope: 'P00 signing/notarization spike only',
  dmg, sha256, submissionId: submission.id, limitations: ['Not a product release', 'Finder launch on a clean macOS 15 machine not verified', 'Published download smoke not applicable: not published'] }, null, 2));
console.log(output);
