import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { execa } from 'execa';
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
 *
 * git is invoked directly rather than through simple-git: every argv here is a
 * compile-time constant, and simple-git's unsafe-operation guard rejects the
 * very hardening flags below (`core.pager`, `diff.external`) because it cannot
 * distinguish our constants from attacker-supplied values.
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

/** Verik's own run artifacts must never be attributed to the wrapped command. */
const EXCLUDE_PATHSPECS = [':(exclude,glob).verik/**', ':(exclude).verik'];

/** Diffs of large repositories comfortably exceed execa's default buffer. */
const MAX_GIT_OUTPUT_BYTES = 256 * 1024 * 1024;

export interface TreeWorkspace {
  /** Temp directory holding the run-scoped index files and object store. */
  dir: string;
  /** Object store the synthesised trees live in. Must outlive the wrapped command. */
  objectDir: string;
  /** The repository's real object store, kept readable via alternates. */
  repoObjectDir: string;
  /** Extra stores made readable — e.g. the durable checkpoint store. */
  extraAlternates: string[];
  dispose(): Promise<void>;
}

/**
 * The ambient environment minus the entire GIT_* namespace.
 *
 * Inherited git variables are actively hostile here. GIT_DIR, GIT_WORK_TREE and
 * GIT_INDEX_FILE are all set when verik runs inside a git hook, and would
 * retarget our plumbing at the hook's repository and index instead of ours. We
 * set every variable that matters below, so nothing of value is lost.
 */
function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith('GIT_')) continue;
    env[key] = value;
  }
  return env;
}

function scopedEnv(ws: TreeWorkspace, indexLabel: string): Record<string, string> {
  return {
    ...inheritedEnv(),
    GIT_INDEX_FILE: join(ws.dir, `${indexLabel}.index`),
    GIT_OBJECT_DIRECTORY: ws.objectDir,
    // Multiple alternates are separated by the platform's path delimiter — ':'
    // on POSIX, ';' on Windows. Hardcoding either silently makes the second
    // store unreadable on the other platform.
    GIT_ALTERNATE_OBJECT_DIRECTORIES: [ws.repoObjectDir, ...ws.extraAlternates].join(delimiter),
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
}

async function git(cwd: string, env: Record<string, string>, args: string[]): Promise<string> {
  const { stdout } = await execa('git', args, {
    cwd,
    env,
    extendEnv: false,
    // Patches are content — a stripped trailing newline changes the bytes.
    stripFinalNewline: false,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  return stdout;
}

/** Workspace-scoped git: temp index, temp object store, real objects readable. */
function scoped(
  root: string,
  ws: TreeWorkspace,
  indexLabel: string,
): (args: string[]) => Promise<string> {
  const env = scopedEnv(ws, indexLabel);
  return (args) => git(root, env, args);
}

/**
 * One workspace per run. The baseline tree is written here before the wrapped
 * command runs and read back afterwards, so this must not be disposed until the
 * whole run is over.
 */
export async function createTreeWorkspace(
  root: string,
  extraAlternates: string[] = [],
): Promise<TreeWorkspace> {
  // `--git-path` rather than join(root, '.git', 'objects'): under linked
  // worktrees and submodules `.git` is a file, not a directory. Resolved to an
  // absolute path because alternates are read relative to the child's cwd.
  const raw = (await git(root, inheritedEnv(), ['rev-parse', '--git-path', 'objects'])).trim();
  const repoObjectDir = resolve(root, raw);

  const dir = await mkdtemp(join(tmpdir(), 'verik-tree-'));
  const objectDir = join(dir, 'objects');
  await mkdir(objectDir, { recursive: true });

  return {
    dir,
    objectDir,
    repoObjectDir,
    extraAlternates,
    dispose: async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/**
 * A durable object store owned by Verik, at `.verik/objects`.
 *
 * A checkpoint tree has to survive long after the process that wrote it — the
 * user may spend an hour prompting an IDE agent between `begin` and `verify` —
 * so it cannot live in the temp workspace. Writing it into `.git/objects` would
 * be simpler but breaks the invariant that Verik never mutates the
 * repository, so it gets its own store and is registered as a git alternate
 * when reading.
 */
export async function ensureCheckpointStore(root: string): Promise<string> {
  const dir = join(root, '.verik', 'objects');
  await mkdir(join(dir, 'info'), { recursive: true });
  await mkdir(join(dir, 'pack'), { recursive: true });
  return dir;
}

/**
 * Writes a tree describing the working tree right now into the durable store.
 * Returns the tree oid, which is all a later `verify` needs.
 */
export async function writeCheckpointTree(
  root: string,
  includeUntracked: boolean,
): Promise<string> {
  const objectDir = await ensureCheckpointStore(root);
  const raw = (await git(root, inheritedEnv(), ['rev-parse', '--git-path', 'objects'])).trim();
  const repoObjectDir = resolve(root, raw);
  const dir = await mkdtemp(join(tmpdir(), 'verik-ckpt-'));

  // Objects go to the durable store; the index is throwaway.
  const ws: TreeWorkspace = {
    dir,
    objectDir,
    repoObjectDir,
    extraAlternates: [],
    dispose: async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };

  try {
    return await buildWorktreeTree(root, ws, 'checkpoint', includeUntracked);
  } finally {
    await ws.dispose();
  }
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
  includeUntracked = true,
): Promise<string> {
  const run = scoped(root, ws, label);

  // Seed the temp index from HEAD. An unborn HEAD has no commit to read.
  try {
    await run(['read-tree', 'HEAD']);
  } catch {
    await run(['read-tree', '--empty']);
  }

  // read-tree brings in whatever HEAD holds, and EXCLUDE_PATHSPECS only filters
  // the `add` below — so a committed `.verik/` entered the index here and was
  // attributed to the agent. That is the documented setup: config.json and
  // policy.json are meant to be committed and team-shared.
  //
  // The visible symptom was the tool reporting its own installation as the
  // agent's work — five files instead of one, and ci-workflow-modified firing
  // on .verik/policy.json — on a new user's first run.
  await run(['rm', '--cached', '-r', '--ignore-unmatch', '--quiet', '--', '.verik']).catch(
    () => undefined,
  );

  // -A stages modifications, additions and deletions, tracked and untracked;
  // -u restricts that to already-tracked paths. Whichever is chosen must be
  // used for *both* trees — an asymmetric build fabricates changes.
  //
  // Never --force: that would pull gitignored files in.
  const mode = includeUntracked ? '-A' : '-u';
  await run(['add', mode, '--ignore-errors', '--', '.', ...EXCLUDE_PATHSPECS]);

  return (await run(['write-tree'])).trim();
}

/**
 * The tree HEAD points at — the committed state, for separating pre-existing
 * dirt from what the wrapped command did.
 *
 * An unborn HEAD yields the empty tree. It is written through `write-tree`
 * rather than hardcoding 4b825dc… so the oid matches the repository's hash
 * algorithm (SHA-256 repositories have a different empty-tree oid).
 */
export async function readHeadTree(root: string, ws: TreeWorkspace): Promise<string> {
  const run = scoped(root, ws, 'head');
  try {
    return (await run(['rev-parse', 'HEAD^{tree}'])).trim();
  } catch {
    await run(['read-tree', '--empty']);
    return (await run(['write-tree'])).trim();
  }
}

/**
 * Resolves an arbitrary ref to its tree, for verifying a base..head range in CI
 * where the working tree is clean and there is nothing uncommitted to inspect.
 */
export async function readRefTree(root: string, ws: TreeWorkspace, ref: string): Promise<string> {
  const run = scoped(root, ws, 'ref');
  return (await run(['rev-parse', `${ref}^{tree}`])).trim();
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

  const run = scoped(root, ws, 'diff');
  const common = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--find-renames'];

  const [patch, nameStatus, numstat] = await Promise.all([
    run([...HARDENED, ...common, '--unified=3', fromTree, toTree]),
    run([...HARDENED, ...common, '--name-status', '-z', fromTree, toTree]),
    run([...HARDENED, ...common, '--numstat', '-z', fromTree, toTree]),
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
    const out = await scoped(
      root,
      ws,
      'pre',
    )([...HARDENED, 'diff', '--name-only', '-z', '--no-color', headTree, baselineTree]);
    return out.split('\0').filter((p) => p.length > 0);
  } catch (err) {
    logger.debug(`Could not compute pre-existing paths: ${String(err)}`);
    return [];
  }
}
