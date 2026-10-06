import type { AdapterEvent } from './adapters.js';
import type { ProcessMessage } from './process.js';

type Block = { id: string; type: string; closed: boolean; claimed: boolean };

/** Qwen SDK 0.1.17 emits one assistant snapshot per block, reusing stream indices
 * and sometimes changing message IDs between the stream and the snapshot.
 * Correlate protocol block boundaries, never deduplicate by equal text. */
export function qwenNormalizer() {
  let sequence = 0;
  let scope = 'initial';
  let blocks: Block[] = [];
  const active = new Map<number, Block>();
  const snapshots = new Map<string, string>();
  const seen = new Set<string>();
  return (message: ProcessMessage): AdapterEvent[] => {
    const output: AdapterEvent[] = [{ kind: 'raw', payload: message }];
    // Preserve the raw delivery but never project an identified replay twice.
    if (typeof message.uuid === 'string') {
      if (seen.has(message.uuid)) return output;
      seen.add(message.uuid);
    }
    if (message.type === 'stream_event') {
      const event = message.event;
      if (event?.type === 'message_start') {
        scope = event.message?.id ?? `message-${++sequence}`;
        blocks = []; active.clear();
      } else if (event?.type === 'content_block_start') {
        const block = { id: `${scope}:block-${++sequence}`, type: event.content_block?.type, closed: false, claimed: false };
        blocks.push(block); active.set(event.index ?? 0, block);
      } else if (event?.type === 'content_block_stop') {
        const block = active.get(event.index ?? 0); if (block) block.closed = true;
      } else if (event?.type === 'content_block_delta') {
        const kind = typeof event.delta?.text === 'string' ? 'text' : typeof event.delta?.thinking === 'string' ? 'reasoning' : undefined;
        if (kind) {
          let block = active.get(event.index ?? 0);
          if (!block || block.closed) {
            block = { id: `${scope}:block-${++sequence}`, type: kind === 'text' ? 'text' : 'thinking', closed: false, claimed: false };
            blocks.push(block); active.set(event.index ?? 0, block);
          }
          output.push({ kind, text: kind === 'text' ? event.delta.text : event.delta.thinking, itemId: block.id, payload: {} });
        }
      }
    } else if (message.type === 'assistant') {
      for (const [index, content] of ((message.message?.content ?? []) as ProcessMessage[]).entries()) {
        const snapshotId = `${message.message?.id ?? message.uuid ?? scope}:${index}`;
        let itemId = snapshots.get(snapshotId);
        if (!itemId) {
          // Snapshot order follows closed block order in this SDK. A new index-0
          // block gets its own ID even if its content is identical to a previous one.
          const matching = blocks.find(block => block.closed && !block.claimed && block.type === content.type);
          if (matching) { matching.claimed = true; itemId = matching.id; }
          else itemId = `snapshot:${snapshotId}`;
          snapshots.set(snapshotId, itemId);
        }
        if (content.type === 'text') output.push({ kind: 'text_snapshot', text: content.text, itemId, payload: {} });
        else if (content.type === 'thinking') output.push({ kind: 'reasoning_snapshot', text: content.thinking, itemId, payload: {} });
        else if (content.type === 'tool_use') output.push({ kind: 'tool', payload: content });
      }
    } else if (message.type === 'user') {
      for (const block of Array.isArray(message.message?.content) ? message.message.content : []) {
        if (block.type === 'tool_result') output.push({ kind: 'tool', payload: block });
      }
    } else if (message.type === 'result') {
      output.push({ kind: message.is_error ? 'error' : 'result', text: message.result, payload: message },
        { kind: 'usage', payload: { usage: message.usage, cost: message.total_cost_usd, scope: 'session', source: 'runtime-estimate' } });
    }
    return output;
  };
}
