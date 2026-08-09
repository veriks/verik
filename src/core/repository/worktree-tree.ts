import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { logger } from '../../shared/logger.js';

/**
 * Builds real git tree objects for the working tree, without touching the
 * user's repository.
 *
 * Attribution used to be set arithmetic over path names, which can only ever be
 * right at file granularity: a file that was already dirty and then edited
 * further by the wrapped command could not be expressed. A tree is a total,
 * content-addressed description of the worktree, so `git diff baseline final`
 * gives hunk-level attribution and collapses the staged/unstaged/untracked
 * trichotomy (an index artifact, not a state distinction).
 *
 * Non-mutation is enforced by redirecting every write away from the repo:
 *   GIT_INDEX_FILE                    index writes go to a temp file
 *   GIT_OBJECT_DIRECTORY              new blobs/trees go to a temp object store
 *   GIT_ALTERNATE_OBJECT_DIRECTORIES  reads still see the real object store
 *   GIT_OPTIONAL_LOCKS=0              never take index.lock in the user's repo
 *
 * No stash, no `git add` against the real index, no checkout, no refs.
 */

/** Neutralises user git config that could corrupt machine-read output. */
const HARDENED = [
  '-c',
  'core.pager=cat',
  '-c',
  'core.quotepath=false',
  '-c',
  'diff.noprefix=false',
  '-c',
  'diff.mnemonicPrefix=false',
  '-c',
  'diff.external=',
];

/** Crosscheck's own run artifacts must never be attributed to the wrapped command. */
const EXCLUDE_PATHSPECS = [':(exclude,glob).crosscheck/**', ':(exclude).crosscheck'];

export interface TreeWorkspace {
  /** Temp directory holding the run-scoped index files and object store. */
  dir: string;
  /** Object store the synthesised trees live in. Must outlive the wrapped command. */
  objectDir: string;
  /** The repository's real object store, kept readable via alternates. */
  repoObjectDir: string;
  dispose(): Promise<void>;
}

/**
 * One workspace per run. The baseline tree is written here before the wrapped
 * command runs and read back afterwards, so this must not be disposed until the
 * whole run is over.
 */
export async function createTreeWorkspace(root: string): Promise<TreeWorkspace> {
  const git = simpleGit(root);
  // `--git-path` rather than join(root, '.git', 'objects'): under linked
  // worktrees and submodules `.git` is a file, not a directory.
  const repoObjectDir = (await git.raw(['rev-parse', '--git-path', 'objects'])).trim();

  const dir = await mkdtemp(join(tmpdir(), 'crosscheck-tree-'));
  const objectDir = join(dir, 'objects');
  await mkdir(objectDir, { recursive: true });

  return {
    dir,
    objectDir,
    repoObjectDir,
    dispose: async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

function scopedGit(root: string, ws: TreeWorkspace, indexLabel: string): SimpleGit {
  return simpleGit(root).env({
    ...process.env,
    GIT_INDEX_FILE: join(ws.dir, `${indexLabel}.index`),
    GIT_OBJECT_DIRECTORY: ws.objectDir,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: ws.repoObjectDir,
    GIT_OPTIONAL_LOCKS: '0',
  });
}

/**
 * Materialises the entire working tree (tracked, staged, untracked; gitignored
 * files excluded by git itself) into a temp index, then writes it as a tree.
 *
 * `label` must differ between baseline and final so the two index files do not
 * collide, but the seeding strategy must be identical for both or
 * skip-worktree/assume-unchanged asymmetry fabricates changes.
 */
export async function buildWorktreeTree(
  root: string,
  ws: TreeWorkspace,
  label: string,
): Promise<string> {
  const git = scopedGit(root, ws, label);

  // Seed the temp index from HEAD. An unborn HEAD has no commit to read.
  try {
    await git.raw(['read-tree', 'HEAD']);
  } catch {
    await git.raw(['read-tree', '--empty']);
  }

  // -A stages modifications, additions and deletions, tracked and untracked.
  // Never --force: that would pull gitignored files in, and asymmetric use
  // would fabricate deletions.
  await git.raw(['add', '-A', '--ignore-errors', '--', '.', ...EXCLUDE_PATHSPECS]);

  return (await git.raw(['write-tree'])).trim();
}

export interface TreeDiffFile {
  path: string;
  previousPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechange';
  additions: number;
  deletions: number;
  isBinary: boolean;
}

/** Parses `--name-status -z`. Renames and copies carry two paths, not one. */
function parseNameStatus(out: string): TreeDiffFile[] {
  const fields = out.split('\0').filter((f) => f.length > 0);
  const files: TreeDiffFile[] = [];

  for (let i = 0; i < fields.length;) {
    const code = fields[i++]!;
    const letter = code[0];
    const base = { additions: 0, deletions: 0, isBinary: false };

    if (letter === 'R' || letter === 'C') {
      const from = fields[i++]!;
      const to = fields[i++]!;
      files.push({
        ...base,
        path: to,
        previousPath: from,
        status: letter === 'R' ? 'renamed' : 'copied',
      });
      continue;
    }

    const path = fields[i++]!;
    const status =
      letter === 'A'
        ? 'added'
        : letter === 'D'
          ? 'deleted'
          : letter === 'T'
            ? 'typechange'
            : 'modified';
    files.push({ ...base, path, status });
  }

  return files;
}

/** Parses `--numstat -z`. Binary files emit literal "-" counts. */
function applyNumstat(out: string, files: TreeDiffFile[]): void {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const fields = out.split('\0').filter((f) => f.length > 0);

  for (let i = 0; i < fields.length;) {
    const row = fields[i++]!;
    const parts = row.split('\t');
    if (parts.length < 3) continue;

    const [addRaw, delRaw, maybePath] = parts as [string, string, string];
    // Renames in -z numstat emit the path as two extra NUL fields.
    const path = maybePath === '' ? (fields[i++], fields[i++]!) : maybePath;

    const target = byPath.get(path);
    if (!target) continue;

    if (addRaw === '-' || delRaw === '-') {
      target.isBinary = true;
    } else {
      target.additions = Number(addRaw) || 0;
      target.deletions = Number(delRaw) || 0;
    }
  }
}

export interface TreeDiff {
  patch: string;
  files: TreeDiffFile[];
  additions: number;
  deletions: number;
}

/** The attributable diff: everything that changed between the two trees. */
export async function diffTrees(
  root: string,
  ws: TreeWorkspace,
  fromTree: string,
  toTree: string,
): Promise<TreeDiff> {
  // Identical trees mean the command changed nothing — even in a dirty repo.
  if (fromTree === toTree) {
    return { patch: '', files: [], additions: 0, deletions: 0 };
  }

  const git = scopedGit(root, ws, 'diff');
  const common = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--find-renames'];

  const [patch, nameStatus, numstat] = await Promise.all([
    git.raw([...HARDENED, ...common, '--unified=3', fromTree, toTree]),
    git.raw([...HARDENED, ...common, '--name-status', '-z', fromTree, toTree]),
    git.raw([...HARDENED, ...common, '--numstat', '-z', fromTree, toTree]),
  ]);

  const files = parseNameStatus(nameStatus);
  applyNumstat(numstat, files);

  return {
    patch,
    files,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
  };
}

/** Paths that were already dirty at baseline, computed from trees rather than a lossy file list. */
export async function preExistingPaths(
  root: string,
  ws: TreeWorkspace,
  headTree: string,
  baselineTree: string,
): Promise<string[]> {
  if (headTree === baselineTree) return [];
  try {
    const git = scopedGit(root, ws, 'pre');
    const out = await git.raw([
      ...HARDENED,
      'diff',
      '--name-only',
      '-z',
      '--no-color',
      headTree,
      baselineTree,
    ]);
    return out.split('\0').filter((p) => p.length > 0);
  } catch (err) {
    logger.debug(`Could not compute pre-existing paths: ${String(err)}`);
    return [];
  }
}
