import { readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { simpleGit } from 'simple-git';
import { sha256 } from '../../shared/hashing.js';
import { logger } from '../../shared/logger.js';

export interface FileEntry {
  path: string;
  hash: string;
  size: number;
}

export interface RepositorySnapshot {
  capturedAt: string;
  commitSha: string;
  branch: string;
  stagedDiff: string;
  unstagedDiff: string;
  untrackedFiles: string[];
  trackedChangedFiles: FileEntry[];
  hash: string;
}

export async function captureSnapshot(
  root: string,
  maxFileBytes: number,
): Promise<RepositorySnapshot> {
  const git = simpleGit(root);
  const status = await git.status();
  const commitSha = (await git.revparse(['HEAD'])).trim();
  const branch = status.current ?? 'HEAD';
  const stagedDiff = await git.diff(['--cached']);
  const unstagedDiff = await git.diff();

  const changedPaths = [
    ...status.modified,
    ...status.created,
    ...status.deleted,
    ...status.renamed.map((r) => r.to),
    ...status.staged,
  ];
  const uniquePaths = [...new Set(changedPaths)];

  const trackedChangedFiles: FileEntry[] = [];
  for (const p of uniquePaths) {
    const fullPath = join(root, p);
    try {
      const info = await stat(fullPath);
      if (info.size > maxFileBytes) {
        logger.debug(`Skipping large file in snapshot: ${p} (${info.size} bytes)`);
        continue;
      }
      const content = await readFile(fullPath);
      trackedChangedFiles.push({ path: p, hash: sha256(content), size: info.size });
    } catch {
      // deleted file
      trackedChangedFiles.push({ path: p, hash: 'deleted', size: 0 });
    }
  }

  const fingerprint = sha256(
    JSON.stringify({ commitSha, stagedDiff, unstagedDiff, trackedChangedFiles }),
  );

  return {
    capturedAt: new Date().toISOString(),
    commitSha,
    branch,
    stagedDiff,
    unstagedDiff,
    untrackedFiles: status.not_added,
    trackedChangedFiles,
    hash: fingerprint,
  };
}

export function resolveRelativePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath);
}
