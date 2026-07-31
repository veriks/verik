import { join } from 'node:path';

export const CROSSCHECK_DIR = '.crosscheck';

export function crosscheckDir(repoRoot: string): string {
  return join(repoRoot, CROSSCHECK_DIR);
}

export function runsDir(repoRoot: string): string {
  return join(repoRoot, CROSSCHECK_DIR, 'runs');
}

export function runDir(repoRoot: string, runId: string): string {
  return join(repoRoot, CROSSCHECK_DIR, 'runs', runId);
}

export function cacheDir(repoRoot: string): string {
  return join(repoRoot, CROSSCHECK_DIR, 'cache');
}

export function runFilePath(repoRoot: string, runId: string, filename: string): string {
  return join(runDir(repoRoot, runId), filename);
}
