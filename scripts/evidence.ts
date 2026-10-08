import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, lstatSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { platform, arch, release } from 'node:os';
import { executable, cleanEnvironment } from '../runtime/process.js';

export const DEFAULT_FINGERPRINT_ROOTS = ['runtime', 'macos/Sources', 'macos/Tests', 'macos/UITests', 'scripts', 'tests', 'fixtures', 'package.json', 'pnpm-lock.yaml', 'macos/project.yml', 'macos/Node.entitlements', '.github'];

/** What a live check actually depends on: the runtime, its fixtures and its dependencies. Editing a script or a test does not make a provider smoke stale. */
export const FRESHNESS_ROOTS = ['runtime', 'fixtures', 'package.json', 'pnpm-lock.yaml'];

export function sourceFingerprint(roots = DEFAULT_FINGERPRINT_ROOTS) {
  const hash = createHash('sha256');
  const visit = (path: string) => {
    if (!existsSync(path)) return;
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
    freshnessFingerprint: sourceFingerprint(FRESHNESS_ROOTS),
    machine: { platform: platform(), arch: arch(), kernel: release(),
      os: execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
      hardware: execFileSync('/usr/sbin/sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim() },
    node: process.versions.node, nativeVersions,
    dependencies: JSON.parse(readFileSync('package.json','utf8')).dependencies,
  };
}

/** Patterns that must never reach an evidence file. Names only, never the matched text. */
export const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'openai-style key', pattern: /\bsk-[A-Za-z0-9_-]{12,}/ },
  { name: 'github token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})/ },
  { name: 'bearer token', pattern: /Bearer\s+[A-Za-z0-9._~+/-]{16,}/i },
  { name: 'credential url', pattern: /https?:\/\/[^\s/@]+:[^\s/@]+@/ },
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

export function findSecrets(text: string): string[] {
  return SECRET_PATTERNS.filter(entry => entry.pattern.test(text)).map(entry => entry.name);
}

export class SecretInEvidenceError extends Error {
  constructor(readonly names: string[], readonly target: string) {
    super(`Evidenza ${target} rifiutata: contiene ${names.join(', ')}`);
    this.name = 'SecretInEvidenceError';
  }
}

/** Serialize a smoke report to build/evidence/<name>.json, refusing anything that looks like a credential. */
export function writeSmoke(name: string, report: object, directory = 'build/evidence') {
  const text = JSON.stringify(report, null, 2);
  const names = findSecrets(text);
  const target = join(directory, `${name}.json`);
  if (names.length) throw new SecretInEvidenceError(names, target);
  mkdirSync(directory, { recursive: true });
  writeFileSync(target, text);
  return target;
}

/** Record that a required real check could not run (no credentials, cap reached, Mac unavailable). */
export function writeBlocked(name: string, reason: string, extra: object = {}, directory = 'build/evidence') {
  return writeSmoke(name, { ...provenance(), status: 'blocked', reason, ...extra }, directory);
}

export type FreshnessContext = { currentFingerprint: string; currentFreshness?: string; paths: string[]; cwd?: string };

/**
 * An evidence file is fresh when it was produced from exactly these sources, or from a clean commit
 * after which none of the freshness paths changed and the working tree is still clean on those paths.
 */
export function isFresh(evidence: { commit?: string; dirty?: boolean; sourceFingerprint?: string; freshnessFingerprint?: string }, context: FreshnessContext) {
  if (evidence.freshnessFingerprint && context.currentFreshness && evidence.freshnessFingerprint === context.currentFreshness) return true;
  if (evidence.sourceFingerprint && evidence.sourceFingerprint === context.currentFingerprint) return true;
  if (evidence.dirty || !evidence.commit || !/^[0-9a-f]{7,40}$/.test(evidence.commit)) return false;
  const options = { encoding: 'utf8' as const, cwd: context.cwd, stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'] };
  const known = spawnSync('git', ['cat-file', '-e', `${evidence.commit}^{commit}`], options);
  if (known.status !== 0) return false;
  const committed = spawnSync('git', ['diff', '--quiet', evidence.commit, 'HEAD', '--', ...context.paths], options);
  if (committed.status !== 0) return false;
  const working = spawnSync('git', ['status', '--porcelain', '--', ...context.paths], options);
  return working.status === 0 && !working.stdout.trim();
}
