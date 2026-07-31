import { minimatch } from 'minimatch';
import type { ChangedFile } from './diff-capture.js';

const ALWAYS_EXCLUDED = [
  '.git/**',
  '.crosscheck/runs/**',
  '.crosscheck/cache/**',
  'node_modules/**',
  'vendor/**',
  'dist/**',
  'build/**',
  '.next/**',
  '__pycache__/**',
  '*.pyc',
];

export function isExcluded(filePath: string, extraPatterns: string[]): boolean {
  const patterns = [...ALWAYS_EXCLUDED, ...extraPatterns];
  return patterns.some((p) => minimatch(filePath, p, { dot: true }));
}

export function filterFiles(
  files: ChangedFile[],
  excludePatterns: string[],
): ChangedFile[] {
  return files.filter((f) => !isExcluded(f.path, excludePatterns));
}

export function selectContextFiles(
  changedPaths: string[],
  allPaths: string[],
  excludePatterns: string[],
): string[] {
  const filtered = allPaths.filter((p) => !isExcluded(p, excludePatterns));
  // Prioritize changed files, then nearby files
  const changed = new Set(changedPaths);
  return filtered.filter((p) => changed.has(p));
}
