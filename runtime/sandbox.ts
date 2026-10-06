import { realpath, mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from './protocol.js';

/** OS-enforced write scope. The CLI remains unmodified; its descendants inherit the policy. */
export async function cursorSandbox(command: string, args: string[], directories: string[], home: string, writable: boolean) {
  if (process.platform !== 'darwin') throw new AppError(400, 'Isolamento Cursor disponibile soltanto su macOS');
  await mkdir(home, { recursive: true, mode: 0o700 });
  // Cursor uses a fixed /tmp fallback for long socket paths. Keep its own data path short instead.
  const temporary = await mkdtemp('/private/tmp/lagoto-cursor-');
  const roots = await Promise.all([home, temporary, ...(writable ? directories : [])].map(path => realpath(path)));
  const quote = (path: string) => JSON.stringify(path);
  const profile = ['(version 1)', '(allow default)', '(deny file-write*)',
    '(allow file-write* (literal "/dev/null") (literal "/dev/tty"))',
    ...roots.map(path => `(allow file-write* (subpath ${quote(path)}))`),
  ].join('\n');
  return { command: '/usr/bin/sandbox-exec', args: ['-p', profile, command, ...args], temporary };
}
