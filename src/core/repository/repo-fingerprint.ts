import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from '../../shared/hashing.js';
import { logger } from '../../shared/logger.js';

export interface RepoFingerprint {
  repoId: string;
  createdAt: string;
  remote?: string;
  rootPath: string;
}

const FINGERPRINT_FILE = '.crosscheck/repo.json';

/**
 * A stable identity for this repository.
 * Derived from the remote URL when available, otherwise from the root path.
 * Survives reclones from the same remote — the ID is consistent across machines.
 * Used to scope memory so findings never leak between unrelated repositories
 * that happen to share a local path.
 */
export async function getOrCreateFingerprint(
  rootPath: string,
  remote?: string,
): Promise<RepoFingerprint> {
  const path = join(rootPath, FINGERPRINT_FILE);

  try {
    const raw = await readFile(path, 'utf8');
    const existing = JSON.parse(raw) as RepoFingerprint;
    if (existing.repoId) return existing;
  } catch {
    // not yet created
  }

  const source = remote ?? rootPath;
  const repoId = `repo_${sha256(source).slice(0, 16)}`;
  const fingerprint: RepoFingerprint = {
    repoId,
    createdAt: new Date().toISOString(),
    remote,
    rootPath,
  };

  try {
    await mkdir(join(rootPath, '.crosscheck'), { recursive: true });
    await writeFile(path, JSON.stringify(fingerprint, null, 2), 'utf8');
  } catch (err) {
    logger.warn(`Could not persist repo fingerprint: ${String(err)}`);
  }

  return fingerprint;
}
