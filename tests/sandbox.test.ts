import { it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cursorSandbox } from '../runtime/sandbox.js';

it('enforces Cursor write roots for direct writes, descendants, traversal and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lagoto-scope-'));
  try {
    const allowed = join(root, 'allowed'); const outside = join(root, 'outside');
    await mkdir(allowed); await mkdir(outside); await symlink(outside, join(allowed, 'escape'));
    const script = `const fs=require('fs');const cp=require('child_process');
      fs.writeFileSync('ok.txt','ok');
      for(const p of ['../outside/no.txt','escape/no.txt']) {try{fs.writeFileSync(p,'bad');process.exit(9)}catch(e){if(e.code!=='EPERM')throw e}}
      const child=cp.spawnSync('/bin/sh',['-c','echo bad > ../outside/child.txt']);
      if(child.status===0)process.exit(10);`;
    const launch = await cursorSandbox(process.execPath, ['-e', script], [allowed], join(root, 'home'), true);
    await promisify(execFile)(launch.command, launch.args, { cwd: allowed });
    expect(await readFile(join(allowed, 'ok.txt'), 'utf8')).toBe('ok');
    const readOnly = await cursorSandbox(process.execPath, ['-e', "require('fs').writeFileSync('no.txt','bad')"], [allowed], join(root,'home'), false);
    await expect(promisify(execFile)(readOnly.command, readOnly.args, { cwd: allowed })).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
