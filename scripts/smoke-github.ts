import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { git } from '../runtime/git.js';
import { provenance } from './evidence.js';

const context = provenance();
const gh = (args: string[]) => execFileSync('gh', args, { encoding: 'utf8', timeout: 30000 });
const owner = gh(['api', 'user', '--jq', '.login']).trim();
if (owner !== 'francemazzi') throw new Error('Unexpected GitHub account; no repository created');
const id = randomUUID(); const name = `lagoto-integration-${id.slice(0, 8)}`;
const remote = `${owner}/${name}`;
const directory = await mkdtemp(join(tmpdir(), 'lagoto-github-'));
const output = resolve('build/evidence', `github-${id}.json`); await mkdir('build/evidence', { recursive: true });
const report = { ...context, status: 'failed', id, repository: remote, private: true, directory, steps: [] as string[],
  scope: 'Real private GitHub create/push smoke plus a local transport failure. Not P03/P11 application retry acceptance.', error: null as string | null };
const save = () => writeFile(output, JSON.stringify(report, null, 2));
await save();
try {
  await git(directory, ['init', '-b', 'main']); await git(directory, ['config', 'user.name', 'Lagoto Integration']); await git(directory, ['config', 'user.email', 'integration@example.invalid']);
  await writeFile(join(directory, 'README.md'), '# Lagoto P00 synthetic fixture\n\nNo user code or credentials. This private repository is retained as test evidence.\n');
  await git(directory, ['add', 'README.md']); await git(directory, ['commit', '-m', 'Synthetic integration fixture']);
  await writeFile(join(directory, 'staged.txt'), 'Preserve this index entry through push failure and retry.\n'); await git(directory, ['add', 'staged.txt']);
  const index = await readFile(join(directory, '.git/index')); const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  report.steps.push('Creation intention durable'); await save();
  gh(['repo', 'create', remote, '--private', '--description', 'Lagoto P00 synthetic integration evidence; no personal code']);
  report.steps.push('Private GitHub repository created'); await save();
  await git(directory, ['remote', 'add', 'origin', `https://github.com/${remote}.git`]);
  let failed = false;
  try { await git(directory, ['push', join(directory, 'missing-remote.git'), 'HEAD:main']); } catch { failed = true; }
  if (!failed || sha(await readFile(join(directory, '.git/index'))) !== sha(index)) throw new Error('Failure/index assertion failed');
  report.steps.push('Local transport failure observed; index bytes unchanged'); await save();
  // Reconcile the known repository before retrying; never call create a second time.
  const repository = JSON.parse(gh(['repo', 'view', remote, '--json', 'nameWithOwner,isPrivate']));
  if (repository.nameWithOwner !== remote || !repository.isPrivate) throw new Error('Remote identity or visibility mismatch');
  await git(directory, ['push', 'origin', 'HEAD:main']);
  if (sha(await readFile(join(directory, '.git/index'))) !== sha(index)) throw new Error('Push changed the staging index');
  const local = await git(directory, ['rev-parse', 'HEAD']);
  const pushed = gh(['api', `repos/${remote}/git/ref/heads/main`, '--jq', '.object.sha']).trim();
  if (local !== pushed) throw new Error('Remote commit mismatch');
  report.steps.push('Push verified by remote commit; original staging preserved'); await save();
  gh(['repo', 'archive', remote, '--yes']); report.steps.push('Synthetic repository archived, recoverable and private'); report.status = 'passed';
} catch (error) { report.error = error instanceof Error ? error.message : String(error); }
await save(); console.log(JSON.stringify({ ...report, directory: undefined }, null, 2));
process.exitCode = report.status === 'passed' ? 0 : 1;
