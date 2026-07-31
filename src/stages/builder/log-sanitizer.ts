import { redactSecrets } from '../../shared/redaction.js';

const MAX_TAIL_CHARS = 4000;

export function sanitizeLog(raw: string, maxBytes: number): string {
  const truncated = raw.length > maxBytes ? raw.slice(-maxBytes) : raw;
  return redactSecrets(truncated);
}

export function tailLog(raw: string): string {
  if (raw.length <= MAX_TAIL_CHARS) return redactSecrets(raw);
  return redactSecrets(raw.slice(-MAX_TAIL_CHARS));
}
