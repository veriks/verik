import { join } from 'node:path';

export const VERIK_DIR = '.verik';

export function verikDir(repoRoot: string): string {
  return join(repoRoot, VERIK_DIR);
}

export function runsDir(repoRoot: string): string {
  return join(repoRoot, VERIK_DIR, 'runs');
}

export function runDir(repoRoot: string, runId: string): string {
  return join(repoRoot, VERIK_DIR, 'runs', runId);
}

export function cacheDir(repoRoot: string): string {
  return join(repoRoot, VERIK_DIR, 'cache');
}

export function runFilePath(repoRoot: string, runId: string, filename: string): string {
  return join(runDir(repoRoot, runId), filename);
}
