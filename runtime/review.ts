import type { Store } from './storage.js';
import type { TaskMemory } from './task-memory.js';
import { AppError } from './protocol.js';

/**
 * Ready for review is a state the user asks for and the runtime checks; it is not "completed" (P11.2).
 * Stale proofs, missing criteria and uncertain runs block it, and every human waiver is returned so it stays visible.
 */
export async function requestReview(store: Store, memory: TaskMemory, taskId: string) {
  const status = await memory.status(taskId);
  if (!status.total) throw new AppError(409, 'Nessun criterio di accettazione: definisci cosa significa completato prima della revisione');
  const stale = status.criteria.filter(criterion => criterion.state === 'stale');
  if (stale.length) throw new AppError(409, `Prove obsolete per ${stale.length} criteri: ripeti le verifiche prima della revisione`);
  if (status.missing.length) throw new AppError(409, `${status.missing.length} criteri senza prova valida: nessuna revisione finché mancano`);
  if (status.blockers.length) throw new AppError(409, `Blocchi presenti: ${status.blockers.join('; ')}`);
  store.db.prepare("UPDATE tasks SET status='review' WHERE id=? AND status<>'completed'").run(taskId);
  const waivers = status.criteria.filter(criterion => criterion.state === 'waived').map(criterion => ({ id: criterion.id, content: criterion.content, reason: criterion.override_reason }));
  store.event(taskId, null, 'review_requested', { criteria: status.total, waivers: waivers.length });
  return { status: 'review' as const, waivers, proofs: status.criteria.filter(criterion => criterion.state === 'verified').map(criterion => ({ id: criterion.id, verificationId: criterion.verification_id })),
    note: 'Pronto per la revisione: non equivale a completato' };
}
