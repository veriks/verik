import { relative } from 'node:path';
import { simpleGit } from 'simple-git';
import { buildWorktreeTree, readHeadTree, type TreeWorkspace } from './worktree-tree.js';

/**
 * A snapshot is now two tree oids rather than a bag of diffs and file hashes.
 *
 * The previous shape hashed each changed file individually and carried the full
 * staged and unstaged diffs as strings. That had three problems: files above
 * `maxFileBytes` were silently skipped, so a large pre-existing edit vanished
 * from the baseline and got attributed to the wrapped command; the
 * staged/unstaged split is an index artifact rather than a state distinction;
 * and the diff strings were persisted verbatim into `metadata.json`, putting
 * unredacted secrets on disk.
 *
 * A tree oid is a complete, content-addressed description of the worktree with
 * none of those properties.
 */
export interface RepositorySnapshot {
  capturedAt: string;
  commitSha: string;
  branch: string;
  /** Tree oid of the whole worktree — tracked, staged and untracked alike. */
  tree: string;
  /** Tree oid of HEAD at capture time. */
  headTree: string;
  /** Whether the worktree differed from HEAD when captured. */
  dirty: boolean;
  /** Content-addressed run fingerprint. The tree oid already is one. */
  hash: string;
}

/**
 * `label` must be unique per capture within a workspace — the baseline and
 * final captures each need their own temp index file.
 *
 * `includeUntracked` must be identical across the two captures of a run, or the
 * asymmetry fabricates additions and deletions.
 */
export async function captureSnapshot(
  root: string,
  ws: TreeWorkspace,
  label: string,
  includeUntracked = true,
): Promise<RepositorySnapshot> {
  const git = simpleGit(root);
  const status = await git.status();
  const commitSha = (await git.revparse(['HEAD'])).trim();

  const [tree, headTree] = await Promise.all([
    buildWorktreeTree(root, ws, label, includeUntracked),
    readHeadTree(root, ws),
  ]);

  return {
    capturedAt: new Date().toISOString(),
    commitSha,
    branch: status.current ?? 'HEAD',
    tree,
    headTree,
    dirty: tree !== headTree,
    hash: tree,
  };
}

export function resolveRelativePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath);
}
