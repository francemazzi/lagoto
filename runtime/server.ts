import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { Store } from './storage.js';
import { Service } from './service.js';
import { requestSchema, errorResponse } from './protocol.js';

// The native host supplies an explicit data path. This fallback also supports CLI development.
const dataDirectory = process.env.LAGOTO_DATA_DIR ?? join(homedir(), 'Library', 'Application Support', 'Lagoto');
if (!isAbsolute(dataDirectory)) throw new Error('LAGOTO_DATA_DIR must be absolute');
process.umask(0o077);
const store = new Store(dataDirectory);
const service = new Service(store, event => { void send({ jsonrpc: '2.0', method: 'event', params: event }); });
let initialized = false;
let pending = Buffer.alloc(0);
let serial = Promise.resolve();
let closed = false;
const send = (value: unknown) => new Promise<void>((resolve, reject) => process.stdout.write(JSON.stringify(value) + '\n', error => error ? reject(error) : resolve()));
async function dispatch(line: Buffer) {
  let id: string | number | null = null;
  try {
    let parsed: unknown;
    try { parsed = JSON.parse(line.toString('utf8')); } catch { await send({ jsonrpc: '2.0', id, error: { code: -32700, message: 'JSON non valido' } }); return; }
    const request = requestSchema.parse(parsed); id = request.id;
    if (!initialized && request.method !== 'initialize') { await send({ jsonrpc: '2.0', id, error: { code: -32001, message: 'Handshake richiesto' } }); return; }
    const result = await service.handle(request);
    if (request.method === 'initialize') initialized = true;
    await send({ jsonrpc: '2.0', id, result });
  } catch (error) { await send(errorResponse(id, error)); }
}
process.stdin.on('data', (chunk: Buffer) => {
  pending = Buffer.concat([pending, chunk]);
  if (pending.length > 4 * 1024 * 1024) { process.stderr.write('IPC frame exceeds limit\n'); shutdown(1); return; }
  let newline: number;
  while ((newline = pending.indexOf(10)) >= 0) {
    const frame = pending.subarray(0, newline); pending = pending.subarray(newline + 1);
    if (frame.length) serial = serial.then(() => dispatch(frame)).catch(() => shutdown(1));
  }
});
function shutdown(code = 0) {
  if (closed) return; closed = true;
  void Promise.allSettled([service.runs.shutdown(),service.profiles.shutdown(),service.verifications.shutdown()]).finally(() => { store.close(); process.exit(code); });
}
process.stdin.on('end', () => { void serial.finally(() => shutdown()); });
process.on('SIGTERM', () => shutdown());
process.on('SIGINT', () => shutdown());
