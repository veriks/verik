import { readFile } from 'node:fs/promises';
import { tailLog } from '../../stages/builder/log-sanitizer.js';

export async function readLogTail(logPath: string, maxBytes = 10_000): Promise<string> {
  try {
    const raw = await readFile(logPath, 'utf8');
    return tailLog(raw.slice(-maxBytes));
  } catch {
    return '';
  }
}
