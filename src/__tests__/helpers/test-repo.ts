import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';
import { customAlphabet } from 'nanoid';

const tmpId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

export interface TestRepo {
  root: string;
  write: (path: string, content: string) => Promise<void>;
  commit: (message: string) => Promise<void>;
  cleanup: () => Promise<void>;
}

/**
 * Creates an isolated git repository in a temp directory.
 * Call cleanup() in afterEach/afterAll.
 */
export async function createTestRepo(): Promise<TestRepo> {
  const root = join(tmpdir(), `crosscheck-test-${tmpId()}`);
  await mkdir(root, { recursive: true });

  const git = simpleGit(root);
  await git.init();

  // Minimal git identity — required for commits to work in CI and clean environments.
  await git.addConfig('user.email', 'test@crosscheck.local');
  await git.addConfig('user.name', 'Crosscheck Test');

  const write = async (relativePath: string, content: string) => {
    const full = join(root, relativePath);
    await mkdir(join(root, relativePath, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  };

  const commit = async (message: string) => {
    await git.add('.');
    await git.commit(message);
  };

  const cleanup = async () => {
    await rm(root, { recursive: true, force: true });
  };

  return { root, write, commit, cleanup };
}

/** Write and commit an initial file so HEAD exists. */
export async function initWithCommit(repo: TestRepo, filename = 'README.md', content = '# test'): Promise<void> {
  await repo.write(filename, content);
  await repo.commit('Initial commit');
}
