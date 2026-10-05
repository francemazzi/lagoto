import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { platform, arch, release } from 'node:os';
import { executable, cleanEnvironment } from '../runtime/process.js';

export function sourceFingerprint(roots = ['runtime', 'macos/Sources', 'scripts', 'tests', 'fixtures', 'package.json', 'pnpm-lock.yaml', 'macos/project.yml']) {
  const hash = createHash('sha256');
  const visit = (path: string) => {
    if (lstatSync(path).isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name));
    else { hash.update(path); hash.update('\0'); hash.update(readFileSync(path)); }
  };
  for (const root of roots) visit(root);
  return hash.digest('hex');
}
export function provenance() {
  const nativeVersions = Object.fromEntries(['codex','claude','cursor-agent','git','gh','ollama'].map(name => {
    const path = executable(name);
    try { return [name, path ? execFileSync(path, ['--version'], { encoding: 'utf8', timeout: 10000, env: cleanEnvironment(), stdio: ['ignore','pipe','ignore'] }).trim().split('\n')[0] : null]; }
    catch { return [name, null]; }
  }));
  return {
    date: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
    sourceFingerprint: sourceFingerprint(),
    machine: { platform: platform(), arch: arch(), kernel: release(),
      os: execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
      hardware: execFileSync('/usr/sbin/sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim() },
    node: process.versions.node, nativeVersions,
    dependencies: JSON.parse(readFileSync('package.json','utf8')).dependencies,
  };
}
