import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync} from 'node:fs';
import {realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {executable,cleanEnvironment} from './process.js';
import {AppError} from './protocol.js';
import type {Profile} from './adapters.js';
const execute=promisify(execFile);const require=createRequire(import.meta.url);
export async function runtimeIdentity(profile:Profile){
  const name=profile.provider==='cursor'?'cursor-agent':profile.provider;
  if(['codex','claude','cursor-agent'].includes(name)){
    const path=executable(name,profile.executable);if(!path)throw new AppError(404,'Runtime non installato');
    const {stdout}=await execute(path,['--version'],{env:cleanEnvironment(),timeout:10000});
    const version=stdout.trim().split('\n')[0];if(!version)throw new AppError(409,'Versione runtime non riconosciuta');
    return{runtime:name,path:await realpath(path),version,node:process.versions.node};
  }
  const version=JSON.parse(readFileSync(require.resolve('@qwen-code/sdk/package.json'),'utf8')).version as string;
  return{runtime:'qwen-code-sdk',version,node:process.versions.node};
}
