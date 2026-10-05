import {randomUUID,createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Store} from '../runtime/storage.js';
import {Service} from '../runtime/service.js';
import {GitHubLinks,githubCLI} from '../runtime/github-link.js';
import {git} from '../runtime/git.js';
import {redact} from '../runtime/protocol.js';
import {provenance,sourceFingerprint} from './evidence.js';

const metadata=provenance();const fromFolder=process.argv.includes('--from-folder');const id=randomUUID();
// A folder below this checkout is already inside Git; use an independent directory for the non-Git scenario.
const root=await mkdtemp(join(tmpdir(),`lagoto-github-workflow-${id}-`));
const path=join(root,'source');await mkdir(path);const data=join(root,'data');let store=new Store(data);let service=new Service(store);
const call=(method:string,params:Record<string,unknown>)=>service.handle({jsonrpc:'2.0',id:1,method,params}) as Promise<any>;
const report:any={...metadata,id,status:'failed',fromFolder,scope:'Application preview/create/reconcile/retry using real gh and real private GitHub; one injected transport failure. Optional real non-Git initialization. Not native UI acceptance.',steps:[]};
try{
  const account=await service.github.account();if(account.login!=='francemazzi')throw new Error('Unexpected account; no repository created');
  const project=await call('project/create',{name:'Synthetic GitHub application workflow'});
  await writeFile(join(path,'README.md'),'# Lagoto application integration fixture\n\nSynthetic public-safe content, stored in a private test repository.\n');
  let repository:any;
  if(fromFolder){
    await writeFile(join(path,'.gitignore'),'ignored.txt\n');await writeFile(join(path,'ignored.txt'),'synthetic ignored file\n');await writeFile(join(path,'.env'),'SYNTHETIC_LOCAL_VALUE=fixture\n');
    repository=await call('repository/add',{projectId:project.id,path});
    const scan=await call('repository/initialize/scan',{projectId:project.id,repositoryId:repository.id,id:randomUUID()});
    const prepared=await call('repository/initialize/preview',{id:scan.id,paths:['README.md','.gitignore'],message:'Synthetic application workflow',authorName:'Lagoto Integration',authorEmail:'integration@example.invalid',branch:'main'});
    let gitExists=false;try{await access(join(path,'.git'));gitExists=true;}catch{}if(gitExists)throw new Error('Preview initialized the original folder');
    await call('repository/initialize/confirm',{id:prepared.id,hash:prepared.hash});
    if(await git(path,['ls-tree','-r','--name-only','HEAD'])!=='.gitignore\nREADME.md')throw new Error('Initial commit exceeded selected scope');
    report.steps.push('Non-Git folder scanned; ignored/sensitive names excluded; preview left original without Git; explicit confirmation installed only the selected first commit');
  }else{
    await git(path,['init','-b','main']);await git(path,['config','user.name','Lagoto Integration']);await git(path,['config','user.email','integration@example.invalid']);
    await git(path,['add','README.md']);await git(path,['commit','-m','Synthetic application workflow']);
    repository=await call('repository/add',{projectId:project.id,path});
  }
  await writeFile(join(path,'staged.txt'),'Preserve staged bytes\n');await git(path,['add','staged.txt']);await writeFile(join(path,'staged.txt'),'Preserve unstaged bytes\n');
  const preview=await call('github/preview',{projectId:project.id,repositoryId:repository.id,id:randomUUID(),name:`lagoto-application-${id.slice(0,8)}`,remoteName:'github'});
  report.repository=`${preview.owner}/${preview.name}`;report.operationId=preview.id;
  report.steps.push('Application preview: secure Keychain account, private visibility, exact selected commit; uncommitted files excluded');
  const index=await readFile(join(path,'.git/index'));const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');let failures=0;
  const injected=new GitHubLinks(store,githubCLI,async(cwd,args)=>{if(args.includes('push')&&failures++===0)throw new Error('Synthetic first push transport outage');return git(cwd,args);});
  injected.confirm(preview.id,preview.hash);injected.confirm(preview.id,preview.hash);const first=await injected.wait(preview.id);
  if(first.state!=='failed'||!first.remoteId)throw new Error('Expected remote creation followed by push failure');report.remoteId=first.remoteId;
  if(sha(await readFile(join(path,'.git/index')))!==sha(index))throw new Error('Index changed after failed push');
  report.steps.push('Private repository created once; duplicate confirmation coalesced; injected push failure retained remote ID and staging');
  store.close();store=new Store(data);service=new Service(store);
  await call('github/confirm',{id:preview.id,hash:preview.hash});const resumed=await service.github.wait(preview.id);
  if(resumed.state!=='completed'||resumed.remoteId!==first.remoteId)throw new Error(resumed.error??'Application retry failed');
  const remote=JSON.parse(await githubCLI(['api',`repos/${report.repository}`]));
  const ref=JSON.parse(await githubCLI(['api',`repos/${report.repository}/git/ref/heads/main`]));
  if(!remote.private||remote.id!==first.remoteId||ref.object.sha!==preview.head)throw new Error('Independent GitHub identity/visibility/commit verification failed');
  if(sha(await readFile(join(path,'.git/index')))!==sha(index)||(await readFile(join(path,'staged.txt'),'utf8'))!=='Preserve unstaged bytes\n')throw new Error('Retry changed local staging/work');
  report.pushedCommit=preview.head;report.steps.push('Restart and retry through application service completed; independent GitHub API confirms same repository ID and exact commit; index and unstaged bytes unchanged');
  await githubCLI(['repo','archive',report.repository,'--yes']);report.steps.push('Synthetic repository archived privately and kept recoverable');
  if(sourceFingerprint()!==metadata.sourceFingerprint)throw new Error('Sources changed during smoke');report.status='passed';
}catch(error){report.error=redact(error instanceof Error?error.message:String(error));}
finally{store.close();}
await mkdir('build/evidence',{recursive:true});const output=resolve('build/evidence',`github-workflow-${id}.json`);await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,evidence:output,repository:report.repository,error:report.error}));process.exitCode=report.status==='passed'?0:1;
