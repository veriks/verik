import { mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';
import { customAlphabet } from 'nanoid';

const tmpId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

export interface TestRepo {
  root: string;
  write: (path: string, content: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
  commit: (message: string) => Promise<void>;
  cleanup: () => Promise<void>;
}

/**
 * Creates an isolated git repository in a temp directory.
 * Call cleanup() in afterEach/afterAll.
 */
export async function createTestRepo(): Promise<TestRepo> {
  const created = join(tmpdir(), `verik-test-${tmpId()}`);
  await mkdir(created, { recursive: true });

  // The canonical path, not the one we happened to construct.
  //
  // Temp directories are reached through a symlink or an alias on two of the
  // three platforms CI runs: macOS resolves /var/folders to /private/var/folders,
  // and Windows hands back an 8.3 short name like RUNNER~1 for runneradmin. Git
  // always reports the resolved form, so any test comparing a path git returned
  // against this one failed on macOS and Windows while passing on Linux.
  //
  // Resolving here rather than in each assertion means a test cannot forget.
  const root = await realpath(created);

  const git = simpleGit(root);
  await git.init();

  // Minimal git identity — required for commits to work in CI and clean environments.
  await git.addConfig('user.email', 'test@verik.local');
  await git.addConfig('user.name', 'Verik Test');

  const write = async (relativePath: string, content: string) => {
    const full = join(root, relativePath);
    await mkdir(join(root, relativePath, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  };

  /** Deletes from the worktree only — the index is left alone, as an agent would. */
  const remove = async (relativePath: string) => {
    await rm(join(root, relativePath), { force: true });
  };

  const commit = async (message: string) => {
    await git.add('.');
    await git.commit(message);
  };

  const cleanup = async () => {
    // Windows fails rmdir with EBUSY while another process still holds a handle
    // inside the tree, and git subprocesses release theirs a moment after they
    // exit. Locally that showed up as four tests failing on one run and passing
    // on the next; in CI it would read as a real regression.
    //
    // maxRetries only covers a few errno values, so retry the whole call.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
        return;
      } catch (err) {
        if (attempt === 4) throw err;
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  };

  return { root, write, remove, commit, cleanup };
}

/** Write and commit an initial file so HEAD exists. */
export async function initWithCommit(
  repo: TestRepo,
  filename = 'README.md',
  content = '# test',
): Promise<void> {
  await repo.write(filename, content);
  await repo.commit('Initial commit');
}
