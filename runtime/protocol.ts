import { z } from 'zod';

export const protocolVersion = 1;
export const identifier = z.string().uuid();
export const requestSchema = z.object({
  jsonrpc: z.literal('2.0'), id: z.union([z.string().min(1).max(100), z.number().int()]),
  method: z.string().min(1).max(100), params: z.record(z.string(), z.unknown()).default({}),
}).strict();
export type Request = z.infer<typeof requestSchema>;
export class AppError extends Error {
  constructor(public code: number, message: string) { super(message); }
}
export const now = () => new Date().toISOString();
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) =>
    [k, /^(api[_-]?key|authorization|password|secret|access[_-]?token|refresh[_-]?token|cookie)$/i.test(k) ? '[REDACTED]' : redact(v)]));
  if (typeof value !== 'string') return value;
  return value.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/g, '[REDACTED]')
    .replace(/(Bearer\s+)[\w.+\/-]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[REDACTED]@');
}
export function errorResponse(id: string | number | null, error: unknown) {
  const code = error instanceof AppError ? error.code : error instanceof z.ZodError ? -32602 : -32603;
  const message = error instanceof z.ZodError ? 'Parametri non validi' : error instanceof Error ? String(redact(error.message)) : 'Errore interno';
  return { jsonrpc: '2.0', id, error: { code, message } };
}
