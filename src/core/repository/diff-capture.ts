import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import type { RepositorySnapshot } from './repository-snapshot.js';
import { logger } from '../../shared/logger.js';

export type FileChangeType = 'modified' | 'added' | 'deleted' | 'renamed' | 'binary' | 'untracked';

export interface ChangedFile {
  path: string;
  previousPath?: string;
  changeType: FileChangeType;
  additions: number;
  deletions: number;
  isBinary: boolean;
}

export interface DiffResult {
  patch: string;
  changedFiles: ChangedFile[];
  additions: number;
  deletions: number;
  preExistingChangedPaths: string[];
  commandIntroducedPaths: string[];
  truncated: boolean;
}

export async function computeDiff(
  root: string,
  baseline: RepositorySnapshot,
  maxDiffBytes: number,
  includeUntracked: boolean,
): Promise<DiffResult> {
  const git = simpleGit(root);
  const status = await git.status();

  const preExistingPaths = new Set([
    ...baseline.trackedChangedFiles.map((f) => f.path),
    ...baseline.untrackedFiles,
  ]);

  const changedFiles: ChangedFile[] = [];

  for (const p of status.modified) {
    changedFiles.push({ path: p, changeType: 'modified', additions: 0, deletions: 0, isBinary: false });
  }
  for (const p of status.created) {
    changedFiles.push({ path: p, changeType: 'added', additions: 0, deletions: 0, isBinary: false });
  }
  for (const p of status.deleted) {
    changedFiles.push({ path: p, changeType: 'deleted', additions: 0, deletions: 0, isBinary: false });
  }
  for (const r of status.renamed) {
    changedFiles.push({ path: r.to, previousPath: r.from, changeType: 'renamed', additions: 0, deletions: 0, isBinary: false });
  }
  if (includeUntracked) {
    for (const p of status.not_added) {
      changedFiles.push({ path: p, changeType: 'untracked', additions: 0, deletions: 0, isBinary: false });
    }
  }

  const commandIntroducedPaths = changedFiles
    .map((f) => f.path)
    .filter((p) => !preExistingPaths.has(p));

  let patch = '';
  let truncated = false;
  try {
    const rawPatch = await git.diff(['HEAD']);
    if (Buffer.byteLength(rawPatch) > maxDiffBytes) {
      patch = rawPatch.slice(0, maxDiffBytes) + '\n... [diff truncated]';
      truncated = true;
    } else {
      patch = rawPatch;
    }
  } catch (err) {
    logger.warn('Could not compute diff patch: ' + String(err));
  }

  const additions = (patch.match(/^\+[^+]/gm) ?? []).length;
  const deletions = (patch.match(/^-[^-]/gm) ?? []).length;

  return {
    patch,
    changedFiles,
    additions,
    deletions,
    preExistingChangedPaths: [...preExistingPaths],
    commandIntroducedPaths,
    truncated,
  };
}

export async function getFileContent(
  root: string,
  filePath: string,
  maxBytes: number,
): Promise<string | null> {
  const fullPath = join(root, filePath);
  try {
    const info = await stat(fullPath);
    if (info.size > maxBytes) return null;
    return readFile(fullPath, 'utf8');
  } catch {
    return null;
  }
}
