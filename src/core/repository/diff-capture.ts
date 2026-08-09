import { readFile, stat } from 'node:fs/promises';
import { resolveInsideRepo } from '../../shared/paths-safe.js';
import { prepareSafePatch, type ExcludedFile } from '../privacy/diff-sanitizer.js';
import { asRawPatch, type RawPatch, type SafePatch } from '../privacy/patch-types.js';
import {
  diffTrees,
  preExistingPaths,
  type TreeDiffFile,
  type TreeWorkspace,
} from './worktree-tree.js';
import type { RepositorySnapshot } from './repository-snapshot.js';

export type FileChangeType = TreeDiffFile['status'];

export interface ChangedFile {
  path: string;
  previousPath?: string;
  changeType: FileChangeType;
  additions: number;
  deletions: number;
  isBinary: boolean;
}

export interface DiffResult {
  /**
   * Unredacted git output. Local forensics only — writing it to
   * `.crosscheck/runs/` is fine (gitignored, and the secrets are already in the
   * user's worktree), sending it anywhere is not. The type enforces this.
   */
  patch: RawPatch;
  /** Exclusion-filtered and redacted. The only patch that may leave the machine. */
  safePatch: SafePatch;
  /** Files withheld from `safePatch` by the privacy policy. */
  excludedFiles: ExcludedFile[];
  redactionCount: number;
  changedFiles: ChangedFile[];
  additions: number;
  deletions: number;
  preExistingChangedPaths: string[];
  commandIntroducedPaths: string[];
  truncated: boolean;
  droppedFiles: string[];
}

export interface ComputeDiffOptions {
  root: string;
  workspace: TreeWorkspace;
  baseline: RepositorySnapshot;
  final: RepositorySnapshot;
  maxDiffBytes: number;
  excludePatterns: string[];
}

/**
 * The attributable diff: exactly what the wrapped command changed.
 *
 * Attribution used to be set arithmetic over `git status` path names minus the
 * paths that were dirty at baseline. That is only ever correct at file
 * granularity — a file already dirty and then edited *further* by the command
 * was excluded wholesale, so the command's own edit disappeared. It also relied
 * on `git diff HEAD`, which never contains untracked files, so
 * `includeUntrackedFiles` changed the file list but not the patch.
 *
 * Diffing baseline tree against final tree has neither problem: pre-existing
 * dirt is already baked into the baseline tree, so everything the diff reports
 * is by construction the command's doing, down to the hunk.
 */
export async function computeDiff(opts: ComputeDiffOptions): Promise<DiffResult> {
  const { root, workspace, baseline, final, maxDiffBytes, excludePatterns } = opts;

  const tree = await diffTrees(root, workspace, baseline.tree, final.tree);
  const raw = asRawPatch(tree.patch);
  const safe = prepareSafePatch(raw, excludePatterns, maxDiffBytes);

  const changedFiles: ChangedFile[] = tree.files.map((f) => ({
    path: f.path,
    previousPath: f.previousPath,
    changeType: f.status,
    additions: f.additions,
    deletions: f.deletions,
    isBinary: f.isBinary,
  }));

  return {
    patch: raw,
    safePatch: safe.patch,
    excludedFiles: safe.excludedFiles,
    redactionCount: safe.redactionCount,
    changedFiles,
    // Counted by git, not by regex. The old `/^\+[^+]/gm` missed added blank
    // lines and miscounted any line whose second character was '+'.
    additions: tree.additions,
    deletions: tree.deletions,
    preExistingChangedPaths: await preExistingPaths(
      root,
      workspace,
      baseline.headTree,
      baseline.tree,
    ),
    commandIntroducedPaths: changedFiles.map((f) => f.path),
    truncated: safe.truncated,
    droppedFiles: safe.droppedFiles,
  };
}

/**
 * The uncommitted state of the worktree, diffed against HEAD.
 *
 * For `verify` and `dry-run`, which have no wrapped command and so no baseline
 * other than HEAD — everything uncommitted is the thing under review, and
 * `preExistingChangedPaths` is correctly empty. Owns its workspace: once the
 * patch strings exist nothing needs the trees.
 */
export async function computeWorktreeDiff(opts: {
  root: string;
  maxDiffBytes: number;
  excludePatterns: string[];
  includeUntracked?: boolean;
}): Promise<{ snapshot: RepositorySnapshot; diff: DiffResult }> {
  const { createTreeWorkspace } = await import('./worktree-tree.js');
  const { captureSnapshot } = await import('./repository-snapshot.js');

  const workspace = await createTreeWorkspace(opts.root);
  try {
    const snapshot = await captureSnapshot(
      opts.root,
      workspace,
      'worktree',
      opts.includeUntracked ?? true,
    );
    const diff = await computeDiff({
      root: opts.root,
      workspace,
      baseline: { ...snapshot, tree: snapshot.headTree, dirty: false },
      final: snapshot,
      maxDiffBytes: opts.maxDiffBytes,
      excludePatterns: opts.excludePatterns,
    });
    return { snapshot, diff };
  } finally {
    await workspace.dispose();
  }
}

export async function getFileContent(
  root: string,
  filePath: string,
  maxBytes: number,
): Promise<string | null> {
  // See file-slicer.ts — a committed symlink can escape the repository.
  const fullPath = await resolveInsideRepo(root, filePath);
  if (!fullPath) return null;

  try {
    const info = await stat(fullPath);
    if (info.size > maxBytes) return null;
    return readFile(fullPath, 'utf8');
  } catch {
    return null;
  }
}
