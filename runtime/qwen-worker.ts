import { query, type Query } from '@qwen-code/sdk';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
let active: Query | undefined;
const waiting = new Map<string, (allow: boolean) => void>();
const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + '\n');
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  const message = JSON.parse(line);
  if (message.id && waiting.has(message.id)) { waiting.get(message.id)!(Boolean(message.result?.allow)); waiting.delete(message.id); return; }
  if (message.method !== 'start' || active) return;
  const p = message.params;
  active = query({ prompt: p.prompt, options: { cwd: p.cwd, model: p.model, authType: 'openai', permissionMode: p.mode === 'plan' ? 'plan' : 'default',
    includeDirectories: p.directories, includePartialMessages: true, maxSessionTurns: 8, maxToolCalls: 20, mcpServers: {},
    canUseTool: async (tool, input) => {
      const id = randomUUID();
      const allow = await new Promise<boolean>(resolve => {
        const timeout = setTimeout(() => { waiting.delete(id); resolve(false); }, 55000);
        waiting.set(id, result => { clearTimeout(timeout); resolve(result); });
        send({ jsonrpc: '2.0', id, method: 'permission', params: { tool, input } });
      });
      return allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Operazione non autorizzata' };
    } } });
  void (async () => {
    try {
      let successful = false;
      for await (const message of active!) { send({ method: 'event', params: message }); if (message.type === 'result' && !message.is_error) successful = true; }
      if (!successful) throw new Error('Il runtime non ha riportato un risultato riuscito');
      send({ method: 'complete', params: {} });
    } catch (error) { send({ method: 'failure', params: { message: error instanceof Error ? error.message : 'Errore SDK' } }); }
    finally { await active?.close(); input.close(); process.exit(0); }
  })();
});
input.on('close', () => { void active?.close().finally(() => process.exit(0)); });
