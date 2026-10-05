import { execFileSync } from 'node:child_process';
import { mkdirSync, cpSync, writeFileSync, existsSync, readdirSync, lstatSync, chmodSync, rmSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { collectLicenses } from './licenses.js';
import {provenance,sourceFingerprint} from './evidence.js';

const root = process.cwd();
const buildProvenance=provenance();
if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.versions.node !== '22.23.1')
  throw new Error('This packaging spike requires macOS arm64 and the pinned Node 22.23.1 runtime');
function run(command: string, args: string[], cwd = root) { execFileSync(command, args, { cwd, stdio: 'inherit' }); }
run('pnpm', ['build:runtime']);
mkdirSync('build', { recursive: true });
run('xcodegen', ['generate', '--spec', 'macos/project.yml']);
const configuration = process.argv.includes('--release') ? 'Release' : 'Debug';
run('xcodebuild', ['-project', 'macos/Lagoto.xcodeproj', '-scheme', 'Lagoto', '-configuration', configuration,
  '-derivedDataPath', 'build/Xcode', '-destination', 'platform=macOS,arch=arm64', 'build', 'CODE_SIGNING_ALLOWED=NO', '-quiet']);
const app = resolve(`build/Xcode/Build/Products/${configuration}/Lagoto.app`);
const runtime = join(app, 'Contents/Resources/runtime');
mkdirSync(runtime, { recursive: true });
cpSync('dist/runtime', join(runtime, 'dist/runtime'), { recursive: true });
cpSync(process.execPath, join(runtime, 'node')); chmodSync(join(runtime, 'node'), 0o755);
writeFileSync(join(runtime, 'package.json'), JSON.stringify({ type: 'module' }));
// pnpm's virtual store contains the actual package files. Copy it without dev packages,
// preserving each package's own dependency resolution rather than flattening versions.
const stage = resolve('build/deploy');
if (existsSync(stage)) rmSync(stage, { recursive: true });
run('pnpm', ['--filter', 'lagoto', 'deploy', '--prod', stage]);
if (existsSync(join(runtime, 'node_modules'))) rmSync(join(runtime, 'node_modules'), { recursive: true });
cpSync(join(stage, 'node_modules'), join(runtime, 'node_modules'), { recursive: true, dereference: false, verbatimSymlinks: true,
  filter: source => !/[/\\]prebuilds[/\\](?:win32|linux|linuxmusl|darwin-x64)/.test(source)
    && !/[/\\]vendor[/\\]ripgrep[/\\](?:x64-darwin|(?:arm64|x64)-(?:linux|win32))(?:[/\\]|$)/.test(source) });
cpSync('LICENSE', join(app, 'Contents/Resources/LICENSE'));
collectLicenses(runtime, join(app, 'Contents/Resources/Licenses'));
if(sourceFingerprint()!==buildProvenance.sourceFingerprint)throw new Error('Sources changed during the build; rebuild before signing');
writeFileSync(join(app,'Contents/Resources/build-provenance.json'),JSON.stringify(buildProvenance,null,2));
const signing = process.env.LAGOTO_SIGN_IDENTITY ?? '-';
if (configuration === 'Release' && signing === '-') throw new Error('Release requires LAGOTO_SIGN_IDENTITY (Developer ID)');
const entitlements = resolve('macos/Node.entitlements');
function binaries(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name); const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return [];
    if (stat.isDirectory()) return binaries(path);
    const handle = openSync(path, 'r'); const magic = Buffer.alloc(4);
    try { readSync(handle, magic, 0, 4, 0); } finally { closeSync(handle); }
    return ['cffaedfe', 'feedfacf', 'cafebabe', 'cafebabf'].includes(magic.toString('hex')) && path !== join(runtime, 'node') ? [path] : [];
  });
}
const stamp = signing === '-' ? [] : ['--timestamp'];
const hardening = signing === '-' ? [] : ['--options', 'runtime'];
for (const binary of binaries(runtime)) run('codesign', ['--force', '--sign', signing, ...hardening, ...stamp, binary]);
run('codesign', ['--force', '--sign', signing, ...hardening, ...stamp, '--entitlements', entitlements, join(runtime, 'node')]);
run('codesign', ['--force', '--sign', signing, ...hardening, ...stamp, app]);
run('codesign', ['--verify', '--deep', '--strict', app]);
console.log(app);
