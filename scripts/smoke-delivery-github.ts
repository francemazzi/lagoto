import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../runtime/storage.js';
import { Service } from '../runtime/service.js';
import { git } from '../runtime/git.js';
import { githubCLI } from '../runtime/github-link.js';
import { Deliveries } from '../runtime/delivery.js';
import { provenance, sourceFingerprint } from './evidence.js';
import { redact } from '../runtime/protocol.js';

const metadata = provenance();
const id = randomUUID();
const root = await mkdtemp(join(tmpdir(), 'lagoto-delivery-github-'));
const data = join(root, 'data');
let store = new Store(data);
let service = new Service(store);
const call = (method: string, params: Record<string, unknown>) => service.handle({ jsonrpc: '2.0', id: 1, method, params }) as Promise<any>;
const report: any = { ...metadata, id, status: 'failed', scope: 'Real application delivery on three private synthetic GitHub repositories, one injected push transport error and coordinator restart. No native UI or release acceptance.', steps: [], repositories: [] };
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
try {
  const account = await service.github.account();
  if (account.login !== 'francemazzi') throw new Error('Unexpected account; no repository created');
  const project = await call('project/create', { name: 'Synthetic three-repository GitHub delivery' });
  const repositories: any[] = [];
  for (const name of ['backend', 'frontend', 'desktop']) {
    const path = join(root, name); await mkdir(path);
    await git(path, ['init', '-b', 'main']);
    await git(path, ['config', 'user.name', 'Lagoto Integration']);
    await git(path, ['config', 'user.email', 'integration@example.invalid']);
    // Explicit transport configuration belongs only to these synthetic repositories.
    await git(path, ['config', '--local', 'credential.helper', '']);
    await git(path, ['config', '--local', '--add', 'credential.helper', '!gh auth git-credential']);
    await writeFile(join(path, 'contract.json'), '{"version":1}\n');
    await writeFile(join(path, 'unrelated.txt'), 'Original unrelated file\n');
    await git(path, ['add', 'contract.json', 'unrelated.txt']); await git(path, ['commit', '-m', 'Synthetic delivery fixture']);
    const repo = await call('repository/add', { projectId: project.id, path }); repositories.push(repo);
    const preview = await call('github/preview', { projectId: project.id, repositoryId: repo.id, id: randomUUID(), name: `lagoto-delivery-${id.slice(0, 8)}-${name}`, remoteName: 'github' });
    await call('github/confirm', { id: preview.id, hash: preview.hash });
    const created = await service.github.wait(preview.id);
    if (created.remoteId) report.repositories.push({ slug: `${preview.owner}/${preview.name}`, id: created.remoteId, branch: preview.branch });
    if (created.state !== 'completed') throw new Error(created.error ?? 'Private fixture setup failed');
  }
  report.steps.push('Three private synthetic repositories created via application preview/confirmation; official gh credential helper explicitly configured only in fixture Git config');
  const task = await call('task/create', { projectId: project.id, title: 'Deliver shared contract version 2' });
  const worktrees = await call('task/prepare', { taskId: task.id, repositoryIds: repositories.map(r => r.id) });
  for (const work of worktrees) {
    await writeFile(join(work.path, 'contract.json'), '{"version":2}\n');
    await writeFile(join(work.path, 'unrelated.txt'), 'Unrelated staged work\n'); await git(work.path, ['add', 'unrelated.txt']);
    await writeFile(join(work.path, 'unrelated.txt'), 'Unrelated unstaged work\n');
  }
  let failedOnce = false;
  const deliveries = new Deliveries(store, async (cwd, args) => {
    if (cwd === worktrees[1].path && args.includes('push') && !failedOnce) { failedOnce = true; throw new Error('Synthetic second-repository push transport outage'); }
    return git(cwd, args);
  });
  const preview = await deliveries.preview(task.id, randomUUID(), 'Synthetic contract version 2', worktrees.map((w: any) => ({ repositoryId: w.repository_id, paths: ['contract.json'], remote: 'github' })));
  const first = await deliveries.confirm(preview.id, preview.hash);
  if (first.state !== 'failed' || first.items[0]?.state !== 'delivered' || first.items[1]?.state !== 'pushing' || first.items[2]?.state !== 'pending') throw new Error('Expected explicit partial result on second repository');
  const firstCommits = first.items.slice(0, 2).map(i => i.commit);
  const indices = await Promise.all(worktrees.map(async (w: any) => sha(await readFile(await git(w.path, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])))));
  report.steps.push('First repository delivered; second commit preserved with failed push; third remains pending; partial result visible to caller');
  store.close(); store = new Store(data); service = new Service(store);
  const resumed = await new Deliveries(store).confirm(preview.id, preview.hash);
  if (resumed.state !== 'delivered' || resumed.items.slice(0, 2).some((item, i) => item.commit !== firstCommits[i])) throw new Error('Retry duplicated a commit or failed');
  const commitCounts: number[] = [];
  for (let i = 0; i < worktrees.length; i++) {
    const work = worktrees[i], delivered = resumed.items[i]!, source = repositories.find(r => r.id === work.repository_id);
    const remoteInfo = report.repositories.find((r: any) => r.slug.endsWith('-' + source.name));
    const remote = JSON.parse(await githubCLI(['api', `repos/${remoteInfo.slug}`]));
    const ref = JSON.parse(await githubCLI(['api', `repos/${remoteInfo.slug}/git/ref/heads/${delivered.branch}`]));
    if (!remote.private || remote.id !== remoteInfo.id || ref.object.sha !== delivered.commit) throw new Error('Independent remote identity/commit validation failed');
    const count = Number(await git(work.path, ['rev-list', '--count', `${delivered.base}..HEAD`]));
    if (count !== 1) throw new Error('Delivery commit duplicated'); commitCounts.push(count);
    if (await git(work.path, ['show', ':unrelated.txt']) !== 'Unrelated staged work' || await readFile(join(work.path, 'unrelated.txt'), 'utf8') !== 'Unrelated unstaged work\n') throw new Error('Unrelated staging or working bytes changed');
    if (i < 2 && sha(await readFile(await git(work.path, ['rev-parse', '--path-format=absolute', '--git-path', 'index']))) !== indices[i]) throw new Error('Retry changed an already committed index');
    if (await git(source.path, ['status', '--porcelain']) || await readFile(join(source.path, 'contract.json'), 'utf8') !== '{"version":1}\n') throw new Error('Original clone was modified');
    remoteInfo.deliveredBranch = delivered.branch; remoteInfo.deliveredCommit = delivered.commit;
  }
  report.commitCounts = commitCounts;
  report.steps.push('Restart and retry delivered all three private repositories; GitHub API confirms same IDs and exact commits; one delivery commit per repository; unrelated staged/unstaged content and original clones preserved');
  if (sourceFingerprint() !== metadata.sourceFingerprint) throw new Error('Sources changed during test');
  report.status = 'passed';
} catch (error) { report.error = String(redact(error instanceof Error ? error.message : String(error))); }
finally {
  store.close();
  for (const repo of report.repositories) {
    try { await githubCLI(['repo', 'archive', repo.slug, '--yes']); repo.archived = true; }
    catch (error) { report.status = 'failed'; repo.archiveError = String(redact(String(error))); }
  }
}
await mkdir('build/evidence', { recursive: true });
const output = resolve('build/evidence', `delivery-github-${id}.json`); await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, evidence: output, repositories: report.repositories, error: report.error }, null, 2));
process.exitCode = report.status === 'passed' ? 0 : 1;
