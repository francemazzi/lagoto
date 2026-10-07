import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, mkdir, access, stat, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './storage.js';
import { AppError, redact } from './protocol.js';

const execute = promisify(execFile);
/**
 * Git runs code named in a repository's own configuration: hooks, fsmonitor, clean/smudge filters, pagers and ssh
 * commands. A repository, or an agent editing the shared config from a worktree, must not be able to make Lagoto
 * execute it (P12.4). Every call therefore disables those vectors and neutralizes any filter the repository defines.
 */
const ENV = () => ({ HOME: process.env.HOME, PATH: process.env.PATH, LANG: 'en_US.UTF-8', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_EXTERNAL_DIFF: '', GIT_PAGER: 'cat', GIT_ASKPASS: '', GIT_EDITOR: 'true' });
const BASE = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.pager=cat', '-c', 'core.editor=true', '-c', 'core.sshCommand=ssh', '-c', 'protocol.ext.allow=never', '-c', 'gc.auto=0'];
async function guard(cwd: string): Promise<string[]> {
  const overrides: string[] = [];
  try {
    // One call reads every scope (repository, worktree, user); any filter command found is replaced by an empty one.
    const { stdout } = await execute('git', [...BASE, 'config', '--get-regexp', '-z', '^filter\\..*\\.(clean|smudge|process)$'], { cwd, encoding: 'utf8', timeout: 10000, env: ENV() });
    for (const entry of stdout.split('\0').filter(Boolean)) { const key = entry.split('\n')[0]!; if (/^filter\.[^\n]+\.(clean|smudge|process)$/.test(key)) overrides.push('-c', `${key}=`); }
  } catch { /* no matching entries or no repository: nothing to neutralize */ }
  return [...BASE, ...overrides];
}
/** Commands that can call an external diff driver or a textconv program get both disabled explicitly. */
function safeArgs(args: string[]): string[] {
  const command = args[0];
  if (command && ['diff', 'log', 'show', 'format-patch'].includes(command)) {
    const extra = ['--no-ext-diff', '--no-textconv'].filter(flag => !args.includes(flag));
    return [command, ...extra, ...args.slice(1)];
  }
  return args;
}
export async function gitBytes(cwd: string, args: string[]): Promise<Buffer> {
  const { stdout } = await execute('git', [...await guard(cwd), ...safeArgs(args)], { cwd, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, timeout: 30000, env: ENV() });
  return stdout;
}
export async function git(cwd: string, args: string[]) {
  const { stdout } = await execute('git', [...await guard(cwd), ...safeArgs(args)], { cwd, maxBuffer: 20 * 1024 * 1024, timeout: 30000, env: ENV() });
  // NUL-delimited paths and trailing whitespace in filenames are meaningful.
  return args.includes('-z') ? stdout : stdout.replace(/\n$/, '');
}
export function githubIdentity(remote: string): string | null {
  const match = remote.match(/^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i);
  return match?.[1]?.toLowerCase() ?? null;
}
export function safeRemoteURL(remote:string){
  if(/^https?:\/\//i.test(remote)){const url=new URL(remote);if(url.username||url.password||url.search||url.hash)throw new AppError(400,'Remote con credenziali o parametri: configura Git con il credential store');}
  return remote;
}
export async function repositoryIdentity(path:string,root:string|null){
  const common=root ? await realpath(await git(path,['rev-parse','--path-format=absolute','--git-common-dir'])) : path;
  const info=await stat(common);
  return {device:info.dev,inode:info.ino,git:Boolean(root)};
}
export async function addRepository(store: Store, projectId: string, directory: string) {
  store.project(projectId);
  const canonical = await realpath(directory);
  let root: string | null = null;
  try { root = await realpath(await git(canonical, ['rev-parse', '--show-toplevel'])); } catch { /* Non-Git folders remain candidates. */ }
  const path = root ?? canonical;
  let remote: string | null = null;
  if (root) {
    const names = (await git(root, ['remote'])).split('\n').filter(Boolean);
    const identities = new Set<string>();
    for (const name of names) { const id = githubIdentity(await git(root, ['remote', 'get-url', name])); if (id) identities.add(id); }
    if (identities.size === 1) remote = `https://github.com/${[...identities][0]}`;
  }
  const id = randomUUID();
  const identity=JSON.stringify(await repositoryIdentity(path,root));
  store.db.prepare('INSERT OR IGNORE INTO repositories(id,project_id,name,path,git_root,remote,identity) VALUES(?,?,?,?,?,?,?)')
    .run(id, projectId, basename(path), path, root, remote,identity);
  if(root)store.db.prepare('UPDATE repositories SET git_root=?,identity=?,remote=? WHERE project_id=? AND path=? AND git_root IS NULL').run(root,identity,remote,projectId,path);
  return store.db.prepare('SELECT * FROM repositories WHERE project_id=? AND path=?').get(projectId, path);
}
/** Refuse states where an automatic worktree would hide a problem instead of isolating work (P04-I06). */
export async function assertPreparable(path: string) {
  if (!await git(path, ['symbolic-ref', '-q', 'HEAD']).catch(() => '')) throw new AppError(409, 'HEAD scollegato: scegli un branch prima di preparare il lavoro');
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
    const target = await git(path, ['rev-parse', '--path-format=absolute', '--git-path', marker]);
    try { await access(target); throw new AppError(409, 'Merge, rebase o cherry-pick in corso: risolvi i conflitti prima di preparare il lavoro'); }
    catch (error) { if (error instanceof AppError) throw error; }
  }
  if ((await git(path, ['ls-files', '--stage'])).split('\n').some(line => line.startsWith('160000 '))) throw new AppError(400, 'Submodule: preparazione automatica non supportata');
  const lfs = (await git(path, ['grep', '-I', '-l', '-e', 'filter=lfs', '--', ':(glob)**/.gitattributes']).catch(() => '')).trim();
  if (lfs) throw new AppError(400, 'Git LFS: file grandi non gestiti, preparazione automatica non supportata');
}
export type TaskRepository = { task_id: string; repository_id: string; path: string; branch: string; base: string };
export async function prepareWorktrees(store: Store, taskId: string, repositoryIds: string[], executeGit = git) {
  const task = store.task(taskId);
  const unique = [...new Set(repositoryIds)].sort();
  if (!unique.length) throw new AppError(400, 'Seleziona almeno un repository');
  const existing=store.db.prepare('SELECT * FROM task_repositories WHERE task_id=? ORDER BY repository_id').all(taskId) as TaskRepository[];
  if(existing.length){
    if(JSON.stringify(existing.map(r=>r.repository_id))!==JSON.stringify(unique))throw new AppError(409,'Il task ha già un diverso insieme di repository');
    for(const row of existing)if(await realpath(await git(row.path,['rev-parse','--show-toplevel']))!==await realpath(row.path))throw new AppError(409,'Worktree spostato o non più valido');
    return existing;
  }
  const repos=unique.map(id=>{
    const repo=store.db.prepare('SELECT * FROM repositories WHERE id=? AND project_id=?').get(id,task.project_id) as {id:string;path:string;git_root:string|null}|undefined;
    if(!repo?.git_root)throw new AppError(400,'Repository non pronto o esterno al progetto');return repo;
  });
  let plan=store.db.prepare('SELECT * FROM preparations WHERE task_id=? ORDER BY repository_id').all(taskId) as (TaskRepository&{state:string})[];
  if(plan.length && JSON.stringify(plan.map(r=>r.repository_id))!==JSON.stringify(unique))throw new AppError(409,'Riprendi la preparazione con gli stessi repository');
  if(!plan.length){
    const intended:TaskRepository[]=[];
    for(const repo of repos){
      await access(repo.path);const base=await git(repo.path,['rev-parse','--verify','HEAD']);
      await assertPreparable(repo.path);
      intended.push({task_id:taskId,repository_id:repo.id,path:join(store.directory,'worktrees',taskId,repo.id),branch:`codex/lagoto-${taskId.slice(0,8)}`,base});
    }
    store.db.transaction(()=>{for(const row of intended)store.db.prepare("INSERT INTO preparations VALUES(@task_id,@repository_id,@path,@branch,@base,'planned')").run(row);})();
    plan=intended.map(row=>({...row,state:'planned'}));
  }
  try {
    for(const row of plan){
      const repo=repos.find(r=>r.id===row.repository_id)!;
      await mkdir(join(store.directory,'worktrees',taskId),{recursive:true});
      let present=false;try{await access(row.path);present=true;}catch{}
      if(!present)await executeGit(repo.path,['worktree','add','-b',row.branch,row.path,row.base]);
      const common=await realpath(await git(row.path,['rev-parse','--path-format=absolute','--git-common-dir']));
      const original=await realpath(await git(repo.path,['rev-parse','--path-format=absolute','--git-common-dir']));
      if(common!==original || await git(row.path,['rev-parse','HEAD'])!==row.base || await git(row.path,['branch','--show-current'])!==row.branch)
        throw new AppError(409,'Preparazione parziale modificata: riconciliazione richiesta, nessun file sovrascritto');
      store.db.prepare("UPDATE preparations SET state='prepared' WHERE task_id=? AND repository_id=?").run(taskId,row.repository_id);
    }
    store.db.transaction(()=>{for(const row of plan)store.db.prepare('INSERT INTO task_repositories VALUES(?,?,?,?,?)').run(row.task_id,row.repository_id,row.path,row.branch,row.base);})();
    return plan.map(({state:_state,...row})=>row);
  }catch(error){store.event(taskId,null,'preparation_failed',{message:String(redact(String(error))),recoverable:true});throw error;}
}
export type ChangedFile = { path: string; area: 'staged' | 'unstaged' | 'untracked'; status: string; binary: boolean };
const DIFF_LIMIT = 1024 * 1024;
/** Every changed file with its area, so nothing is dropped silently when a diff is large or binary (P11.1). */
export async function changedFiles(directory: string): Promise<ChangedFile[]> {
  const files: ChangedFile[] = [];
  const binary = new Set<string>();
  for (const args of [['diff', '--cached', '--numstat', '-z'], ['diff', '--numstat', '-z']]) {
    const out = (await git(directory, args)).split('\0');
    for (let i = 0; i < out.length; i++) { const entry = out[i]!; const match = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(entry); if (!match) continue; let path = match[3]!; if (path === '') { path = out[i + 2] ?? ''; i += 2; } if (match[1] === '-') binary.add(path); }
  }
  const parse = (raw: string, area: 'staged' | 'unstaged') => {
    const parts = raw.split('\0').filter(Boolean);
    for (let i = 0; i < parts.length; i++) { const status = parts[i]!; const path = parts[i + 1]!; i += status.startsWith('R') || status.startsWith('C') ? 2 : 1; if (path) files.push({ path, area, status: status[0]!, binary: binary.has(path) }); }
  };
  parse(await git(directory, ['diff', '--cached', '--name-status', '-z']), 'staged');
  parse(await git(directory, ['diff', '--name-status', '-z']), 'unstaged');
  for (const path of (await git(directory, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)) {
    let isBinary = false; try { isBinary = (await readFile(join(directory, path))).subarray(0, 8000).includes(0); } catch { /* unreadable stays visible as untracked */ }
    files.push({ path, area: 'untracked', status: '?', binary: isBinary });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path) || a.area.localeCompare(b.area));
}
export async function diffs(store: Store, taskId: string) {
  store.task(taskId);
  const repos = store.db.prepare('SELECT tr.*,r.name FROM task_repositories tr JOIN repositories r ON r.id=tr.repository_id WHERE task_id=?').all(taskId) as (TaskRepository&{name:string})[];
  return Promise.all(repos.map(async repo => {
    const diff = await git(repo.path, ['diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--']);
    const files = await changedFiles(repo.path);
    const latest = store.db.prepare("SELECT state FROM verifications WHERE task_id=? AND json_extract(command,'$.repositoryId')=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(taskId, repo.repository_id) as { state: string } | undefined;
    return { ...repo,
      paths:[...new Set([...(await git(repo.path,['diff','--name-only','-z','HEAD','--'])).split('\0'),...(await git(repo.path,['ls-files','--others','--exclude-standard','-z'])).split('\0')].filter(Boolean))],
      files, test: latest?.state ?? 'none',
      remotes:await Promise.all((await git(repo.path,['remote'])).split('\n').filter(Boolean).map(async name=>({name,url:safeRemoteURL(await git(repo.path,['remote','get-url','--push',name]))}))),
      status: await git(repo.path, ['status', '--short']),
      diff: diff.length > DIFF_LIMIT ? diff.slice(0, DIFF_LIMIT) : diff, diffTruncated: diff.length > DIFF_LIMIT, diffBytes: diff.length,
    };
  }));
}
