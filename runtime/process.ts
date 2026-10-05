import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join, dirname, isAbsolute } from 'node:path';
import { AppError } from './protocol.js';

export function executable(name: string, configured?: string | null): string | null {
  const folders = [dirname(process.execPath), join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', ...(process.env.PATH ?? '').split(':').filter(Boolean)];
  const candidates = configured ? [configured] : folders.map(folder => join(folder, name));
  if (!configured && name === 'codex') candidates.push('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', '/Applications/Codex.app/Contents/Resources/codex');
  for (const path of candidates) { if (!isAbsolute(path)) continue; try { accessSync(path, constants.X_OK); return path; } catch {} }
  return null;
}
export function cleanEnvironment(extra: Record<string, string> = {}): Record<string, string> {
  return { HOME: homedir(), USER: userInfo().username, LOGNAME: userInfo().username,
    PATH: [dirname(process.execPath), join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':'), LANG: 'en_US.UTF-8', ...extra };
}
export type ProcessMessage = Record<string, any>;
export class JsonProcess {
  readonly child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private nextId = 0;
  private pending = new Map<string | number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  onMessage: (value: ProcessMessage) => void = () => {};
  onClose: (code: number | null) => void = () => {};
  onOutput: (bytes:Buffer)=>void = ()=>{};
  private exited = false;
  private stopPromise?: Promise<void>;
  private leaderExited = false;
  private exitPromise: Promise<void>;
  private closedPromise: Promise<void>;
  constructor(command: string, args: string[], cwd: string, environment: Record<string, string> = cleanEnvironment(), format:'json'|'text'='json') {
    this.child = spawn(command, args, { cwd, env: environment, stdio: 'pipe', detached: true });
    this.child.stdout.on('data', (chunk: Buffer) => {
      if(format==='text'){this.onOutput(chunk);return;}
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.buffer.length > 8 * 1024 * 1024) { this.fail(new AppError(413, 'Evento del provider troppo grande')); void this.stop(); return; }
      let index: number;
      while ((index = this.buffer.indexOf(10)) >= 0) {
        const line = this.buffer.subarray(0, index); this.buffer = this.buffer.subarray(index + 1);
        if (!line.length) continue;
        try {
          const message = JSON.parse(line.toString('utf8')) as ProcessMessage;
          const waiter = this.pending.get(message.id);
          if (waiter && !message.method && ('result' in message || 'error' in message)) {
            clearTimeout(waiter.timer); this.pending.delete(message.id);
            if (message.error) waiter.reject(new AppError(502, message.error.message ?? 'Errore provider'));
            else waiter.resolve(message.result);
          } else this.onMessage(message);
        } catch (error) { this.fail(new AppError(502, `Protocollo non valido: ${error instanceof SyntaxError ? 'JSON incompleto' : 'evento rifiutato'}`)); void this.stop(); }
      }
    });
    // Drain stderr; never forward credentials or opaque diagnostic payloads to the journal.
    this.child.stderr.resume();
    if(format==='text')this.child.stderr.on('data',(chunk:Buffer)=>this.onOutput(chunk));
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.exitPromise = new Promise(resolve => {
      this.child.once('exit', () => { this.leaderExited = true; resolve(); });
      this.child.once('error', () => { this.leaderExited = true; resolve(); });
    });
    this.closedPromise = new Promise(resolve => this.child.once('close', code => {
      this.exited = true; this.fail(new AppError(502, 'Connessione al provider terminata')); this.onClose(code); resolve();
    }));
  }
  send(message: unknown) {
    if (this.exited || this.child.stdin.destroyed) throw new AppError(409, 'Processo già terminato');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method: string, params: unknown, timeout = 30000): Promise<any> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new AppError(504, `Timeout provider: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ jsonrpc: '2.0', id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  private fail(error: Error) { for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); } this.pending.clear(); }
  stop(): Promise<void> {
    this.stopPromise ??= this.stopOwnedProcess();
    return this.stopPromise;
  }
  private async stopOwnedProcess() {
    const pid = this.child.pid;
    const snapshot = () => execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,lstart='], { encoding: 'utf8' }).trim().split('\n').flatMap(row => {
      const match = row.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
      return match ? [{ pid: Number(match[1]), group: Number(match[2]), started: match[3]! }] : [];
    });
    const initial = pid ? snapshot() : [];
    // Capture descendants only while our ChildProcess leader is still observable.
    // A matching group after an unobserved parent exit alone is not ownership proof.
    const owned = !this.leaderExited && initial.some(row => row.pid === pid && row.group === pid)
      ? initial.filter(row => row.group === pid && row.pid !== pid) : [];
    if (!this.exited) {
      this.child.stdin.end();
      await Promise.race([this.exitPromise, new Promise(resolve => setTimeout(resolve, 1000))]);
      if (!this.leaderExited && pid) { try { process.kill(-pid, 'SIGTERM'); } catch {} }
      await Promise.race([this.exitPromise, new Promise(resolve => setTimeout(resolve, 2500))]);
      if (!this.leaderExited && pid) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
      await Promise.race([this.exitPromise, new Promise(resolve => setTimeout(resolve, 2500))]);
      if (!this.leaderExited) throw new AppError(409, 'Arresto del processo non verificato');
    }
    // The process group can survive the leader. Never report a clean stop while it remains.
    if (pid) {
      const groupAlive = () => snapshot().some(row => row.group === pid);
      const signalOwned = (signal: NodeJS.Signals) => {
        const current = snapshot();
        for (const child of owned) if (current.some(row => row.pid === child.pid && row.group === child.group && row.started === child.started)) {
          try { process.kill(child.pid, signal); } catch (error: any) { if (error.code !== 'ESRCH') throw error; }
        }
      };
      signalOwned('SIGTERM');
      for (let attempt = 0; attempt < 10 && groupAlive(); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
      signalOwned('SIGKILL');
      for (let attempt = 0; attempt < 20 && groupAlive(); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
      if (groupAlive()) throw new AppError(409, 'Processo figlio ancora attivo: passaggio bloccato');
    }
    await Promise.race([this.closedPromise, new Promise(resolve => setTimeout(resolve, 1000))]);
    if (!this.exited) throw new AppError(409, 'Stream del processo ancora aperti: arresto incerto');
  }
}
