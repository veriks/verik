import { simpleGit } from 'simple-git';
import { RepositoryError } from '../../shared/errors.js';

export interface RepositoryInfo {
  root: string;
  branch: string;
  commitSha: string;
  remote?: string;
  isDirty: boolean;
  isDetachedHead: boolean;
  isBorn: boolean;
}

export async function getRepositoryInfo(dir: string): Promise<RepositoryInfo> {
  const git = simpleGit(dir);

  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new RepositoryError(`Not a Git repository: ${dir}`);
  }

  const root = (await git.revparse(['--show-toplevel'])).trim();
  const gitWithRoot = simpleGit(root);

  let isBorn = true;
  let commitSha = '';
  try {
    commitSha = (await gitWithRoot.revparse(['HEAD'])).trim();
  } catch {
    isBorn = false;
  }

  if (!isBorn) {
    throw new RepositoryError('Repository has no commits yet (unborn).');
  }

  const status = await gitWithRoot.status();
  const branch = status.current ?? 'HEAD';
  const isDetachedHead = status.detached ?? false;
  const isDirty = !status.isClean();

  let remote: string | undefined;
  try {
    const remotes = await gitWithRoot.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0];
    remote = origin?.refs?.fetch;
  } catch {
    // no remotes
  }

  return { root, branch, commitSha, remote, isDirty, isDetachedHead, isBorn };
}

export async function getStagedDiff(root: string): Promise<string> {
  const git = simpleGit(root);
  return git.diff(['--cached']);
}

export async function getUnstagedDiff(root: string): Promise<string> {
  const git = simpleGit(root);
  return git.diff();
}

export async function getUntrackedFiles(root: string): Promise<string[]> {
  const git = simpleGit(root);
  const status = await git.status();
  return status.not_added;
}
