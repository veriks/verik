import { realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

/**
 * Resolves `filePath` against `root` and returns the absolute path only if it
 * genuinely lives inside the repository.
 *
 * Paths reaching us come from `git status`, so they are repo-relative — but a
 * repository can legitimately contain a *committed symlink* pointing outside
 * itself (`ln -s /etc/passwd notes.txt`, or a link to a sibling checkout).
 * Reading through one would send file contents from outside the repository to
 * the LLM, so the check resolves symlinks before deciding.
 *
 * Returns null when the path escapes, does not exist, or is otherwise unreadable.
 */
export async function resolveInsideRepo(root: string, filePath: string): Promise<string | null> {
  // Reject absolute paths and traversal before touching the filesystem.
  if (isAbsolute(filePath)) return null;
  const candidate = resolve(join(root, filePath));

  try {
    // realpath collapses symlinks; the repo root is resolved too so that a
    // symlinked checkout (common on macOS, where /tmp -> /private/tmp) does not
    // make every path look external.
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(candidate)]);
    return isInside(realRoot, realTarget) ? realTarget : null;
  } catch {
    return null;
  }
}

/** True when `target` is `root` itself or nested beneath it. */
export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  // '' means target === root. A leading '..' means it escaped. An absolute
  // result means the two are on different Windows drives.
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
