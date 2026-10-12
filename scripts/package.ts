import { execFileSync } from 'node:child_process';
import { mkdirSync, cpSync, symlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { provenance, writeBlocked, writeSmoke } from './evidence.js';
import { inspectBundle } from './package-checks.js';

// Release packaging: DMG, SHA-256, release notes and evidence. Never tags and never uploads: publishing is a separate explicit step.
// Two distributions, chosen by the environment (docs/distribution.md):
//  - zero cost (default): ad-hoc signed bundle, no Apple account involved; Gatekeeper asks the user to open it consciously.
//    Usage: LAGOTO_UNSIGNED=1 pnpm build --release && pnpm package
//  - Developer ID: Developer ID signature, notarization, staple, Gatekeeper. Only when an Apple Developer membership already exists.
//    Usage: LAGOTO_SIGN_IDENTITY=... LAGOTO_NOTARY_PROFILE=... pnpm build --release && pnpm package
const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
const identity = process.env.LAGOTO_SIGN_IDENTITY;
const profile = process.env.LAGOTO_NOTARY_PROFILE;
const stamp = new Date().toISOString().replaceAll(':', '-');
const notarized = Boolean(identity && profile);
if (!notarized && (identity || profile)) {
  const target = writeBlocked(`package-${version}-${stamp}`, 'LAGOTO_SIGN_IDENTITY e LAGOTO_NOTARY_PROFILE vanno impostati insieme', { scope: 'Release packaging not attempted' });
  console.log(`blocked: ${target}`); process.exit(2);
}
if (!notarized && process.env.LAGOTO_UNSIGNED !== '1') {
  const target = writeBlocked(`package-${version}-${stamp}`, 'Distribuzione non scelta: imposta LAGOTO_UNSIGNED=1 (a costo zero) oppure identità e profilo di notarizzazione', { scope: 'Release packaging not attempted' });
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
function releaseNotes(version: string, name: string, sha: string, notarized: boolean) {
  const verify = `\`\`\`bash\nshasum -a 256 ${name}   # deve stampare ${sha}\n\`\`\``;
  if (notarized) return `# Lagoto ${version}\n\nBeta per macOS 15 su Apple Silicon. Firmata con Developer ID e notarizzata da Apple.\n\n## Verifica del download\n\n${verify}\n`;
  return `# Lagoto ${version}\n\nBeta per macOS 15 su Apple Silicon, per utenti tecnici. **L'app non è firmata con un certificato Apple Developer e non è notarizzata**: macOS mostrerà un avviso alla prima apertura. Il codice sorgente è in questo repository e puoi compilarlo da te.\n\n## Verifica del download\n\n${verify}\n\nConfronta il valore con il file \`${name}.sha256\` di questa release, scaricata da questa pagina.\n\n## Prima apertura\n\n1. Apri il DMG e trascina Lagoto in Applicazioni.\n2. In Applicazioni fai clic destro su Lagoto, scegli **Apri** e conferma **Apri**.\n3. Se l'avviso non offre "Apri": **Impostazioni di Sistema → Privacy e sicurezza**, in fondo premi **Apri comunque** accanto a Lagoto.\n\nNon disattivare Gatekeeper per l'intero sistema: non serve.\n`;
}
const dmg = join(output, name);
let status: 'passed' | 'failed' = 'failed'; let submissionId: string | undefined; let error: string | undefined; let sha256: string | undefined;
try {
  if (failed.length) throw new Error(`Controlli del bundle falliti: ${failed.map(check => check.name).join(', ')}`);
  symlinkSync('/Applications', join(stage, 'Applications'));
  run('codesign', ['--verify', '--deep', '--strict', app]);
  run('hdiutil', ['create', '-volname', `Lagoto ${version}`, '-srcfolder', stage, '-ov', '-format', 'UDZO', dmg]);
  if (notarized) {
    run('codesign', ['--sign', identity!, '--timestamp', dmg]);
    const submission = JSON.parse(execFileSync('xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', profile!, '--wait', '--output-format', 'json'], { encoding: 'utf8', timeout: 1800000 }));
    submissionId = submission.id;
    writeFileSync(join(output, 'notary.json'), JSON.stringify({ id: submission.id, status: submission.status }, null, 2));
    if (submission.status !== 'Accepted') throw new Error(`Notarizzazione ${submission.status}: ispeziona la submission ${submission.id}`);
    for (const target of [app, dmg]) { run('xcrun', ['stapler', 'staple', target]); run('xcrun', ['stapler', 'validate', target]); }
    run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
  }
  sha256 = createHash('sha256').update(readFileSync(dmg)).digest('hex');
  writeFileSync(`${dmg}.sha256`, `${sha256}  ${name}\n`);
  writeFileSync(join(output, 'notes.md'), releaseNotes(version, name, sha256, notarized));
  status = 'passed';
} catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
const target = writeSmoke(`package-${version}-${stamp}`, { ...provenance(), buildProvenance, status, version, distribution: notarized ? 'developer-id-notarized' : 'unsigned-zero-cost', dmg: name, sha256, submissionId, bundleChecks: checks, error,
  limitations: ['Finder launch on a clean macOS 15 machine, update over a previous version and the redownloaded published artifact are checked separately (P12-I01 attestation)'] });
console.log(JSON.stringify({ status, evidence: target, error }, null, 2));
process.exitCode = status === 'passed' ? 0 : 1;
