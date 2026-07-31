import { createHash } from 'node:crypto';

export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function sha256File(content: string): string {
  return sha256(content);
}
