import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync,renameSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../runtime/storage.js';
import {Service} from '../runtime/service.js';
import {git} from '../runtime/git.js';
import {Repositories} from '../runtime/repositories.js';
import {JsonProcess,cleanEnvironment} from '../runtime/process.js';
import {GitHubLinks} from '../runtime/github-link.js';

const roots:string[]=[];const stores:Store[]=[];const managers:Repositories[]=[];
const temp=()=>{const p=mkdtempSync(join(tmpdir(),'lagoto-repositories-'));roots.push(p);return p;};
const call=(s:Service,method:string,params:Record<string,unknown>={})=>s.handle({jsonrpc:'2.0',id:1,method,params}) as Promise<any>;
async function fixture(){const root=temp(),store=new Store(join(root,'data'));stores.push(store);const service=new Service(store);managers.push(service.repositories);
  const project=await call(service,'project/create',{name:'Repository flow'});
  const path=join(root,'source');mkdirSync(path);await git(path,['init','-b','main']);await git(path,['config','user.name','Lagoto fixture']);await git(path,['config','user.email','fixture@example.invalid']);
  writeFileSync(join(path,'contract.json'),'{"version":1}\n');await git(path,['add','contract.json']);await git(path,['commit','-m','Fixture']);
  const repo=await call(service,'repository/add',{projectId:project.id,path});return{root,store,service,project,path,repo};}
async function finished(manager:Repositories,id:string){for(let i=0;i<200;i++){const row=manager.clone(id);if(!['starting','running','stopping'].includes(row.state))return row;await new Promise(r=>setTimeout(r,20));}throw new Error('Clone did not finish');}
afterEach(async()=>{for(const m of managers.splice(0))await m.shutdown();for(const s of stores.splice(0))s.close();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});

it('P03-I03 clones real Git into an exclusive destination once and preserves an existing folder',async()=>{
  const {root,service,project,path}=await fixture();const destination=join(root,'clone'),id=randomUUID();
  await call(service,'repository/clone',{projectId:project.id,id,source:path,destination});expect((await finished(service.repositories,id)).state).toBe('completed');
  expect(await git(destination,['rev-parse','HEAD'])).toBe(await git(path,['rev-parse','HEAD']));
  expect((await call(service,'repository/clone',{projectId:project.id,id,source:path,destination})).state).toBe('completed');
  writeFileSync(join(destination,'keep.txt'),'unchanged');
  await expect(call(service,'repository/clone',{projectId:project.id,id:randomUUID(),source:path,destination})).rejects.toThrow('EEXIST');
  expect(readFileSync(join(destination,'keep.txt'),'utf8')).toBe('unchanged');
  expect((await call(service,'repository/list',{projectId:project.id}))).toHaveLength(2);
});

it('P03-I03 rejects credential URLs and executable transports before creating any destination',async()=>{
  const {root,service,project}=await fixture();const destination=join(root,'never-created');
  for(const source of ['https://user:secret@github.com/a/b','https://github.com/a/b?token=private','ext::sh -c dangerous','--upload-pack=/tmp/no','file:///tmp/source'])
    await expect(call(service,'repository/clone',{projectId:project.id,id:randomUUID(),source,destination})).rejects.toThrow();
  expect(existsSync(destination)).toBe(false);
});

it('P03-I03 cancels a real child process, keeps partial output and never registers an incomplete clone',async()=>{
  const {root,store,service,project,path}=await fixture();const destination=join(root,'partial');
  const manager=new Repositories(store,(_args,cwd)=>new JsonProcess(process.execPath,['-e','process.stdout.write("receiving objects"); setInterval(()=>{},1000)'],cwd,cleanEnvironment(),'text'));managers.push(manager);
  const id=randomUUID();await manager.startClone(project.id,id,path,destination);
  writeFileSync(join(destination,'partial-object'),'recover me');
  expect((await manager.cancelClone(id)).state).toBe('cancelled');
  expect(readFileSync(join(destination,'partial-object'),'utf8')).toBe('recover me');
  expect((await call(service,'repository/list',{projectId:project.id}))).toHaveLength(1);
  expect(store.db.prepare("SELECT state FROM process_leases WHERE owner_id=?").get(id)).toEqual({state:'stopped'});
},15000);

it('P03-I05 repairs a moved original repository and its existing task worktree, rejecting an unrelated clone',async()=>{
  const {root,service,project,path,repo}=await fixture();
  const task=await call(service,'task/create',{projectId:project.id,title:'Moved repository'});
  const [work]=await call(service,'task/prepare',{taskId:task.id,repositoryIds:[repo.id]});
  writeFileSync(join(work.path,'contract.json'),'{"version":2}\n');await git(work.path,['add','contract.json']);
  const index=readFileSync(await git(work.path,['rev-parse','--path-format=absolute','--git-path','index']));
  const impostor=join(root,'other-clone');await git(root,['clone',path,impostor]);
  const moved=join(root,'moved');renameSync(path,moved);
  expect((await call(service,'repository/inspect',{projectId:project.id,repositoryId:repo.id})).availability).toBe('unavailable');expect(existsSync(path)).toBe(false);
  await expect(call(service,'repository/relink',{projectId:project.id,repositoryId:repo.id,path:impostor})).rejects.toThrow('Identità');
  expect((await call(service,'repository/relink',{projectId:project.id,repositoryId:repo.id,path:moved})).availability).toBe('ready');
  expect(await git(work.path,['show',':contract.json'])).toBe('{"version":2}');
  expect(readFileSync(await git(work.path,['rev-parse','--path-format=absolute','--git-path','index']))).toEqual(index);
  expect(readFileSync(join(moved,'contract.json'),'utf8')).toBe('{"version":1}\n');
});

it('P03-I02/P03-I07 deduplicates aliases/subfolders, preserves clones and resolves ambiguous remotes without push',async()=>{
  const {root,service,project,path,repo}=await fixture();mkdirSync(join(path,'nested'));symlinkSync(path,join(root,'alias'));
  for(const candidate of [join(root,'alias'),join(path,'nested')])expect((await call(service,'repository/add',{projectId:project.id,path:candidate})).id).toBe(repo.id);
  await git(path,['remote','add','origin','git@github.com:Example/First.git']);await git(path,['remote','add','upstream','https://github.com/example/second.git']);
  const info=await call(service,'repository/inspect',{projectId:project.id,repositoryId:repo.id});expect(info.candidates.map((r:any)=>r.github)).toEqual(['example/first','example/second']);expect(info.githubVerified).toBe(false);
  expect((await call(service,'repository/selectRemote',{projectId:project.id,repositoryId:repo.id,name:'upstream'})).remote).toBe('https://github.com/example/second');
  expect(await git(path,['remote'])).toBe('origin\nupstream');
});

it('P03-I01 preserves rename/order/archive across restart and never deletes repository files',async()=>{
  const {root,store,service,project,path}=await fixture();const second=await call(service,'project/create',{name:'Second'});
  await call(service,'project/rename',{projectId:project.id,name:'Renamed'});await call(service,'project/reorder',{ids:[second.id,project.id]});
  expect((await call(service,'project/list')).map((p:any)=>p.name)).toEqual(['Second','Renamed']);
  await expect(call(service,'project/reorder',{ids:[second.id,second.id]})).rejects.toThrow('una sola volta');
  await call(service,'project/archive',{projectId:project.id});store.close();const reopened=new Store(join(root,'data'));stores.push(reopened);const s=new Service(reopened);managers.push(s.repositories);
  expect((await call(s,'project/archived'))[0].name).toBe('Renamed');expect(readFileSync(join(path,'contract.json'),'utf8')).toBe('{"version":1}\n');
  await call(s,'project/restore',{projectId:project.id});expect((await call(s,'project/list')).map((p:any)=>p.name)).toEqual(['Second','Renamed']);
});

async function githubFixture(){
  const f=await fixture();const bare=join(f.root,'remote.git');mkdirSync(bare);await git(bare,['init','--bare']);
  let remote:any=null;let creates=0;let failPush=false;let loseResponse=false;let login='fixture-user';let source='keyring';
  const gh=async(args:string[])=>{
    if(args[0]==='auth')return JSON.stringify({hosts:{'github.com':[{active:true,state:'success',login,tokenSource:source}]}});
    if(args[1]==='user')return JSON.stringify({id:7,login});
    if(args.includes('POST')){
      creates++;remote={id:32,full_name:`${login}/${args.find(a=>a.startsWith('name='))!.slice(5)}`,private:true,owner:{login},description:args.find(a=>a.startsWith('description='))!.slice(12)};
      if(loseResponse){loseResponse=false;throw new Error('Response lost after actual creation');}return JSON.stringify(remote);
    }
    if(args[1]?.startsWith('repos/')){if(remote)return JSON.stringify(remote);throw Object.assign(new Error('Not Found (HTTP 404)'),{stderr:'gh: Not Found (HTTP 404)'});}
    throw new Error('Unexpected gh fixture command');
  };
  const execute=async(path:string,args:string[])=>{if(args.includes('push')&&failPush){failPush=false;throw new Error('Injected remote transport failure');}return git(path,args.map(a=>a.startsWith('https://github.com/')?bare:a));};
  const links=new GitHubLinks(f.store,gh,execute);
  return{...f,links,gh,execute,bare,creates:()=>creates,setFail:()=>{failPush=true;},lose:()=>{loseResponse=true;},switch:()=>{login='different-user';},plaintext:()=>{source='oauth_token';},remote:()=>remote};
}

it('P03-I08 creates once and resumes a failed push after restart without changing the index or an existing remote',async()=>{
  const f=await githubFixture();await git(f.path,['remote','add','origin','ssh://git@example.invalid/existing.git']);
  writeFileSync(join(f.path,'staged.txt'),'keep staged\n');await git(f.path,['add','staged.txt']);writeFileSync(join(f.path,'staged.txt'),'keep unstaged\n');
  const preview=await f.links.preview(f.project.id,f.repo.id,randomUUID(),'new-private','github');
  const index=readFileSync(join(f.path,'.git/index'));f.setFail();
  f.links.confirm(preview.id,preview.hash);f.links.confirm(preview.id,preview.hash);
  expect((await f.links.wait(preview.id)).state).toBe('failed');expect(f.creates()).toBe(1);
  f.store.close();const reopened=new Store(join(f.root,'data'));stores.push(reopened);const resumed=new GitHubLinks(reopened,f.gh,f.execute);
  resumed.confirm(preview.id,preview.hash);expect((await resumed.wait(preview.id)).state).toBe('completed');expect(f.creates()).toBe(1);
  expect(await git(f.bare,['rev-parse','refs/heads/main'])).toBe(preview.head);
  expect(readFileSync(join(f.path,'.git/index'))).toEqual(index);expect(readFileSync(join(f.path,'staged.txt'),'utf8')).toBe('keep unstaged\n');
  expect(await git(f.path,['remote','get-url','origin'])).toBe('ssh://git@example.invalid/existing.git');
});

it('P03-I08 reconciles a lost creation response by operation identity and refuses a repository substituted before retry',async()=>{
  const f=await githubFixture();const preview=await f.links.preview(f.project.id,f.repo.id,randomUUID(),'recover-create','github');f.lose();
  f.links.confirm(preview.id,preview.hash);expect((await f.links.wait(preview.id)).state).toBe('unknown');
  f.links.confirm(preview.id,preview.hash);expect((await f.links.wait(preview.id)).state).toBe('completed');expect(f.creates()).toBe(1);
  const g=await githubFixture();const next=await g.links.preview(g.project.id,g.repo.id,randomUUID(),'remote-replaced','github');g.setFail();g.links.confirm(next.id,next.hash);await g.links.wait(next.id);g.remote().id=999;
  g.links.confirm(next.id,next.hash);expect((await g.links.wait(next.id)).state).toBe('failed');expect((await g.links.wait(next.id)).error).toContain('identità');expect(g.creates()).toBe(1);
});

it('P03-I08 rejects changed files or account and sensitive tracked history before publishing',async()=>{
  const f=await githubFixture();const preview=await f.links.preview(f.project.id,f.repo.id,randomUUID(),'changed-files','github');
  writeFileSync(join(f.path,'contract.json'),'changed');f.links.confirm(preview.id,preview.hash);expect((await f.links.wait(preview.id)).error).toContain('cambiati');expect(f.creates()).toBe(0);
  const g=await githubFixture();const second=await g.links.preview(g.project.id,g.repo.id,randomUUID(),'changed-account','github');g.switch();g.links.confirm(second.id,second.hash);expect((await g.links.wait(second.id)).error).toContain('Account');expect(g.creates()).toBe(0);
  const h=await githubFixture();writeFileSync(join(h.path,'.env'),'SYNTHETIC=fixture');await git(h.path,['add','.env']);await git(h.path,['commit','-m','Sensitive filename fixture']);await git(h.path,['rm','.env']);await git(h.path,['commit','-m','Remove from current tree']);
  await expect(h.links.preview(h.project.id,h.repo.id,randomUUID(),'secret-history','github')).rejects.toThrow('sensibile');expect(h.creates()).toBe(0);
});

it('P03-I07 requires the secure gh credential store and keeps a conflicting remote untouched',async()=>{
  const f=await githubFixture();f.plaintext();await expect(f.links.account()).rejects.toThrow('Portachiavi');
  await git(f.path,['remote','add','github','https://github.com/example/existing.git']);
  await expect(f.links.preview(f.project.id,f.repo.id,randomUUID(),'new-private','github')).rejects.toThrow('esiste già');
  expect(await git(f.path,['remote','get-url','github'])).toBe('https://github.com/example/existing.git');expect(f.creates()).toBe(0);
});

async function folderFixture(){
  const f=await fixture();const folder=join(f.root,'non-git');mkdirSync(folder);
  writeFileSync(join(folder,'README.md'),'# Synthetic project\n');writeFileSync(join(folder,'not-selected.txt'),'Keep this untracked\n');
  writeFileSync(join(folder,'.gitignore'),'ignored.txt\n');writeFileSync(join(folder,'ignored.txt'),'Ignored bytes remain local\n');writeFileSync(join(folder,'.env'),'SYNTHETIC=local-only\n');
  const candidate=await call(f.service,'repository/add',{projectId:f.project.id,path:folder});
  const scan=await call(f.service,'repository/initialize/scan',{projectId:f.project.id,repositoryId:candidate.id,id:randomUUID()});
  const preview=()=>call(f.service,'repository/initialize/preview',{id:scan.id,paths:['README.md','.gitignore'],message:'Selected first commit',authorName:'Lagoto Fixture',authorEmail:'fixture@example.invalid',branch:'main'});
  return{...f,folder,candidate,scan,preview};
}

it('P03-I08 initializes a non-Git folder only after preview, with a selected first commit and no ignored/secret file staged',async()=>{
  const f=await folderFixture();expect(f.scan.excluded).toContainEqual({path:'.env',reason:'Nome sensibile'});expect(f.scan.ignored).toContain('ignored.txt');
  expect(existsSync(join(f.folder,'.git'))).toBe(false);const preview=await f.preview();expect(existsSync(join(f.folder,'.git'))).toBe(false);
  expect(preview.diff).toContain('Synthetic project');
  const ready=await call(f.service,'repository/initialize/confirm',{id:preview.id,hash:preview.hash});expect(ready.state).toBe('completed');
  expect(await git(f.folder,['ls-tree','-r','--name-only','HEAD'])).toBe('.gitignore\nREADME.md');
  expect(await git(f.folder,['show',':README.md'])).toBe('# Synthetic project');expect(await git(f.folder,['rev-list','--count','HEAD'])).toBe('1');
  expect(readFileSync(join(f.folder,'.env'),'utf8')).toBe('SYNTHETIC=local-only\n');expect(readFileSync(join(f.folder,'not-selected.txt'),'utf8')).toBe('Keep this untracked\n');
  expect((await call(f.service,'repository/inspect',{projectId:f.project.id,repositoryId:f.candidate.id})).availability).toBe('ready');
  expect((await call(f.service,'repository/initialize/confirm',{id:preview.id,hash:preview.hash})).commit).toBe(ready.commit);
});

it('P03-I08 refuses changed files, candidate metadata and externally initialized folders without overwriting them',async()=>{
  const f=await folderFixture();const preview=await f.preview();writeFileSync(join(f.folder,'README.md'),'changed after preview\n');
  await expect(call(f.service,'repository/initialize/confirm',{id:preview.id,hash:preview.hash})).rejects.toThrow('cambiati');expect(existsSync(join(f.folder,'.git'))).toBe(false);
  const g=await folderFixture();const second=await g.preview();writeFileSync(join(g.root,'data','initializations',second.id,'candidate','.git','config'),'tampered');
  await expect(call(g.service,'repository/initialize/confirm',{id:second.id,hash:second.hash})).rejects.toThrow('candidato cambiati');expect(existsSync(join(g.folder,'.git'))).toBe(false);
  const h=await folderFixture();const third=await h.preview();await git(h.folder,['init']);const head=readFileSync(join(h.folder,'.git','HEAD'));
  await expect(call(h.service,'repository/initialize/confirm',{id:third.id,hash:third.hash})).rejects.toThrow('EEXIST');expect(readFileSync(join(h.folder,'.git','HEAD'))).toEqual(head);
});

it('P03-I08 resumes a proven partial initialization, refusing symlinks inside Git metadata',async()=>{
  const f=await folderFixture();const preview=await f.preview();const destination=join(f.folder,'.git');mkdirSync(destination);writeFileSync(join(destination,'lagoto-initialization'),preview.id);
  const source=join(f.root,'data','initializations',preview.id,'candidate','.git');writeFileSync(join(destination,'HEAD'),readFileSync(join(source,'HEAD')));
  f.store.db.prepare("UPDATE repository_operations SET state='installing' WHERE id=?").run(preview.id);
  expect((await call(f.service,'repository/initialize/confirm',{id:preview.id,hash:preview.hash})).state).toBe('completed');
  const g=await folderFixture();const other=await g.preview();mkdirSync(join(g.folder,'.git'));writeFileSync(join(g.folder,'.git','lagoto-initialization'),other.id);
  const external=join(g.root,'external');mkdirSync(external);symlinkSync(external,join(g.folder,'.git','objects'));
  g.store.db.prepare("UPDATE repository_operations SET state='installing' WHERE id=?").run(other.id);
  await expect(call(g.service,'repository/initialize/confirm',{id:other.id,hash:other.hash})).rejects.toThrow('link');expect(existsSync(join(external,'info'))).toBe(false);
});

it('P03-I08 rejects a custom clean filter before staging or executing it',async()=>{
  const f=await folderFixture();writeFileSync(join(f.folder,'.gitattributes'),'*.md filter=custom\n');
  const scan=await call(f.service,'repository/initialize/scan',{projectId:f.project.id,repositoryId:f.candidate.id,id:randomUUID()});
  await expect(call(f.service,'repository/initialize/preview',{id:scan.id,paths:['README.md'],message:'No filters',authorName:'Fixture',authorEmail:'fixture@example.invalid',branch:'main'})).rejects.toThrow('Filtri');
  expect(existsSync(join(f.folder,'.git'))).toBe(false);
});
