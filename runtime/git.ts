import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, mkdir, access } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './storage.js';
import { AppError, redact } from './protocol.js';

const execute = promisify(execFile);
export async function gitBytes(cwd: string, args: string[]): Promise<Buffer> {
  const { stdout } = await execute('git',['-c','core.hooksPath=/dev/null',...args],{cwd,encoding:'buffer',maxBuffer:32*1024*1024,timeout:30000,
    env:{HOME:process.env.HOME,PATH:process.env.PATH,LANG:'en_US.UTF-8',GIT_TERMINAL_PROMPT:'0'}});
  return stdout;
}
export async function git(cwd: string, args: string[]) {
  const { stdout } = await execute('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, maxBuffer: 20 * 1024 * 1024, timeout: 30000,
    env: { HOME: process.env.HOME, PATH: process.env.PATH, LANG: 'en_US.UTF-8', GIT_TERMINAL_PROMPT: '0' },
  });
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
  store.db.prepare('INSERT OR IGNORE INTO repositories(id,project_id,name,path,git_root,remote) VALUES(?,?,?,?,?,?)')
    .run(id, projectId, basename(path), path, root, remote);
  return store.db.prepare('SELECT * FROM repositories WHERE project_id=? AND path=?').get(projectId, path);
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
      if((await git(repo.path,['ls-files','--stage'])).split('\n').some(line=>line.startsWith('160000 ')))throw new AppError(400,'Submodule: preparazione automatica non supportata');
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
    return plan.map(({state,...row})=>row);
  }catch(error){store.event(taskId,null,'preparation_failed',{message:String(redact(String(error))),recoverable:true});throw error;}
}
export async function diffs(store: Store, taskId: string) {
  store.task(taskId);
  const repos = store.db.prepare('SELECT tr.*,r.name FROM task_repositories tr JOIN repositories r ON r.id=tr.repository_id WHERE task_id=?').all(taskId) as (TaskRepository&{name:string})[];
  return Promise.all(repos.map(async repo => ({ ...repo,
    paths:[...new Set([...(await git(repo.path,['diff','--name-only','-z','HEAD','--'])).split('\0'),...(await git(repo.path,['ls-files','--others','--exclude-standard','-z'])).split('\0')].filter(Boolean))],
    remotes:await Promise.all((await git(repo.path,['remote'])).split('\n').filter(Boolean).map(async name=>({name,url:safeRemoteURL(await git(repo.path,['remote','get-url','--push',name]))}))),
    status: await git(repo.path, ['status', '--short']),
    diff: await git(repo.path, ['diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--']),
  })));
}
