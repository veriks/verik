import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { runDir, runFilePath, runsDir } from './paths.js';
import { StorageError } from '../shared/errors.js';
import type { RunRecord } from '../core/run/run-state.js';

export async function saveRunFile(
  repoRoot: string,
  runId: string,
  filename: string,
  content: string,
): Promise<void> {
  const dir = runDir(repoRoot, runId);
  await mkdir(dir, { recursive: true });
  const tmp = runFilePath(repoRoot, runId, filename + '.tmp');
  const final = runFilePath(repoRoot, runId, filename);
  await writeFile(tmp, content, 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, final);
}

export async function saveRunJson<T>(
  repoRoot: string,
  runId: string,
  filename: string,
  data: T,
): Promise<void> {
  await saveRunFile(repoRoot, runId, filename, JSON.stringify(data, null, 2));
}

export async function loadRunJson<T>(
  repoRoot: string,
  runId: string,
  filename: string,
): Promise<T> {
  const path = runFilePath(repoRoot, runId, filename);
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    throw new StorageError(`Could not read run file: ${path}`);
  }
}

export async function loadRunRecord(repoRoot: string, runId: string): Promise<RunRecord> {
  return loadRunJson<RunRecord>(repoRoot, runId, 'metadata.json');
}

export async function listRunIds(repoRoot: string): Promise<string[]> {
  const dir = runsDir(repoRoot);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function ensureRunDir(repoRoot: string, runId: string): Promise<void> {
  const dir = runDir(repoRoot, runId);
  try {
    await mkdir(dir, { recursive: true });
  } catch (err) {
    throw new StorageError(`Failed to create run directory: ${String(err)}`);
  }
}

export async function appendLog(
  repoRoot: string,
  runId: string,
  filename: string,
  chunk: string,
): Promise<void> {
  const path = runFilePath(repoRoot, runId, filename);
  const { appendFile } = await import('node:fs/promises');
  await appendFile(path, chunk, 'utf8');
}

export { runDir, runFilePath } from './paths.js';
