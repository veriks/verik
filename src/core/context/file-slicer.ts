import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface FileSlice {
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
}

export async function sliceFile(
  root: string,
  filePath: string,
  maxBytes: number,
  aroundLine?: number,
  contextLines = 40,
): Promise<FileSlice | null> {
  const fullPath = join(root, filePath);
  try {
    const info = await stat(fullPath);
    if (info.size === 0) return null;

    const raw = await readFile(fullPath, 'utf8');
    const lines = raw.split('\n');

    if (!aroundLine || info.size <= maxBytes) {
      const content = raw.length > maxBytes ? raw.slice(0, maxBytes) + '\n... [truncated]' : raw;
      return {
        path: filePath,
        content,
        startLine: 1,
        endLine: lines.length,
        truncated: raw.length > maxBytes,
      };
    }

    const start = Math.max(0, aroundLine - contextLines - 1);
    const end = Math.min(lines.length, aroundLine + contextLines);
    const slice = lines.slice(start, end).join('\n');

    return {
      path: filePath,
      content: slice,
      startLine: start + 1,
      endLine: end,
      truncated: true,
    };
  } catch {
    return null;
  }
}
