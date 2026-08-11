import { simpleGit } from 'simple-git';
import { mkdir, readFile, writeFile, chmod, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * Installing verik as a git pre-commit hook.
 *
 * Rules nobody runs catch nothing, and asking a developer to remember a command
 * after every agent session is asking them to be the reliability mechanism. The
 * hook is how verification stops being something you opt into per commit.
 *
 * Three properties matter more than the feature itself:
 *
 *  - it must never destroy an existing hook. Most repositories that want this
 *    already run husky, lint-staged or pre-commit.
 *  - it must be exactly reversible, leaving no trace of having been there.
 *  - it must never block a commit because verik itself failed. A tool that
 *    stops you committing when it breaks is a tool you uninstall that morning.
 */

export const BEGIN_MARKER = '# >>> verik >>>';
export const END_MARKER = '# <<< verik <<<';

/**
 * Markers written before the tool was renamed.
 *
 * Someone who installed the hook under the old name must still be able to
 * uninstall it. Without this, `hook uninstall` reports "nothing to remove"
 * while the old block sits in their pre-commit calling a binary that no longer
 * exists — the hook then fails on every commit and the documented way out does
 * not work.
 */
const LEGACY_MARKERS = ['# >>> crosscheck >>>', '# <<< crosscheck <<<'] as const;

export type HookState = 'absent' | 'installed' | 'foreign';

export interface HookTarget {
  /** Directory git actually consults for hooks. */
  dir: string;
  /** Absolute path to the pre-commit hook. */
  path: string;
  /**
   * Set when `core.hooksPath` redirects hooks away from `.git/hooks`. Husky
   * does this, and installing into `.git/hooks` in that case produces a file
   * git will never run — the failure looks exactly like success.
   */
  hooksPathOverride: string | null;
}

export interface HookStatus {
  target: HookTarget;
  state: HookState;
  /** Content outside our markers — someone else's hook, which we preserve. */
  hasForeignContent: boolean;
  /**
   * True when foreign content contains an unconditional `exit` before our
   * block would run, which would make the installed block dead code.
   */
  unreachable: boolean;
}

/**
 * `git rev-parse --git-path hooks` resolves correctly inside worktrees and
 * submodules, where `.git` is a file rather than a directory. `core.hooksPath`
 * overrides it entirely and has to be checked separately, since rev-parse does
 * not account for it.
 */
export async function resolveHookTarget(root: string): Promise<HookTarget> {
  const git = simpleGit(root);

  let override: string | null = null;
  try {
    const raw = (await git.raw(['config', '--get', 'core.hooksPath'])).trim();
    if (raw) override = raw;
  } catch {
    // Unset. `git config --get` exits 1 when the key is missing.
  }

  const dir = override
    ? isAbsolute(override)
      ? override
      : resolve(root, override)
    : resolve(root, (await git.raw(['rev-parse', '--git-path', 'hooks'])).trim());

  return { dir, path: join(dir, 'pre-commit'), hooksPathOverride: override };
}

/** An `exit` at the start of a line, outside our block — the hook stops there. */
const UNCONDITIONAL_EXIT = /^exit\b/m;

function splitOn(
  content: string,
  begin: string,
  end: string,
): { before: string; after: string; found: boolean } | null {
  const start = content.indexOf(begin);
  const stop = content.indexOf(end);
  if (start === -1 || stop === -1 || stop < start) return null;
  return { before: content.slice(0, start), after: content.slice(stop + end.length), found: true };
}

function splitBlock(content: string): { before: string; after: string; found: boolean } {
  return (
    splitOn(content, BEGIN_MARKER, END_MARKER) ??
    splitOn(content, LEGACY_MARKERS[0], LEGACY_MARKERS[1]) ?? {
      before: content,
      after: '',
      found: false,
    }
  );
}

async function readHookFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function readHookStatus(root: string): Promise<HookStatus> {
  const target = await resolveHookTarget(root);
  const content = await readHookFile(target.path);

  if (content === null) {
    return { target, state: 'absent', hasForeignContent: false, unreachable: false };
  }

  const { before, after, found } = splitBlock(content);
  const foreign = `${before}${after}`.replace(/^#!.*\n?/, '').trim();

  return {
    target,
    state: found ? 'installed' : 'foreign',
    hasForeignContent: foreign.length > 0,
    // Only content *before* our block can strand it.
    unreachable: UNCONDITIONAL_EXIT.test(before.replace(/^#!.*\n?/, '')),
  };
}

/**
 * The block itself.
 *
 * Output is captured and only printed when the commit is actually blocked, so a
 * passing commit stays silent — the same contract every other hook honours.
 * Exit codes are mapped deliberately rather than passed through: 2 and 3 are
 * verik's "do not ship this" and "blocking mode could not reach a
 * verdict", and everything else means verik itself had a problem, which is
 * not the developer's fault and must not cost them the commit.
 */
export function renderHookBlock(mode: 'rules' | 'full'): string {
  return [
    BEGIN_MARKER,
    '# Managed by `verik hook install`.',
    '# Remove with `verik hook uninstall`, or delete this block by hand.',
    'if command -v verik >/dev/null 2>&1; then',
    `  verik_out=$(verik verify --mode ${mode} 2>&1)`,
    '  verik_rc=$?',
    '  case $verik_rc in',
    '    0) : ;;',
    '    2|3)',
    '      printf %s\\\\n "$verik_out" >&2',
    '      printf "\\nverik blocked this commit." >&2',
    '      printf " Commit anyway with: git commit --no-verify\\n" >&2',
    '      exit 1',
    '      ;;',
    '    *)',
    '      printf "verik could not complete (exit %s) - allowing the commit.\\n" \\',
    '        "$verik_rc" >&2',
    '      ;;',
    '  esac',
    'fi',
    END_MARKER,
  ].join('\n');
}

export interface InstallOptions {
  mode?: 'rules' | 'full';
  /**
   * Put the block before existing hook content rather than after. Needed when
   * the existing hook exits unconditionally, which would otherwise leave ours
   * unreachable.
   */
  prepend?: boolean;
}

export interface InstallResult {
  target: HookTarget;
  /** What was there before we wrote. */
  previousState: HookState;
  preservedForeignContent: boolean;
  backupPath: string | null;
  position: 'prepend' | 'append';
  /** Set when the existing hook would have stranded an appended block. */
  warning?: string;
}

export async function installHook(
  root: string,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const mode = options.mode ?? 'rules';
  const status = await readHookStatus(root);
  const { target } = status;

  await mkdir(dirname(target.path), { recursive: true });

  const existing = (await readHookFile(target.path)) ?? '';
  const { before, after, found } = splitBlock(existing);

  // Reinstalling replaces our block in place and leaves everything else alone,
  // so running install twice is not the same as installing twice.
  const foreignRaw = found ? `${before}${after}` : existing;
  const shebangMatch = /^#!.*\n?/.exec(foreignRaw);
  const shebang = shebangMatch ? shebangMatch[0].trimEnd() : '#!/bin/sh';
  const foreignBody = foreignRaw.replace(/^#!.*\n?/, '').trim();

  let backupPath: string | null = null;
  if (!found && foreignBody.length > 0) {
    // First time we touch someone else's hook, keep a copy. Reinstalls do not
    // overwrite it, so the original is always the pre-verik version.
    backupPath = `${target.path}.verik-backup`;
    try {
      await stat(backupPath);
    } catch {
      await writeFile(backupPath, existing, 'utf8');
    }
  }

  const strandsAppend = UNCONDITIONAL_EXIT.test(foreignBody);
  const position: 'prepend' | 'append' = options.prepend || strandsAppend ? 'prepend' : 'append';

  const block = renderHookBlock(mode);
  const parts = [shebang, ''];
  if (foreignBody.length === 0) {
    parts.push(block, '');
  } else if (position === 'prepend') {
    parts.push(block, '', foreignBody, '');
  } else {
    parts.push(foreignBody, '', block, '');
  }

  await writeFile(target.path, parts.join('\n'), 'utf8');
  // Git ignores a hook that is not executable, and silently — so this is not
  // best-effort tidiness, it is the difference between working and not.
  await chmod(target.path, 0o755).catch(() => undefined);

  return {
    target,
    previousState: status.state,
    preservedForeignContent: foreignBody.length > 0,
    backupPath,
    position,
    warning: strandsAppend
      ? 'The existing hook exits unconditionally, so an appended block would never run. ' +
        'Installed before it instead.'
      : undefined,
  };
}

export interface UninstallResult {
  target: HookTarget;
  /** False when there was nothing of ours to remove. */
  removed: boolean;
  /** True when the file was deleted because nothing else was left in it. */
  fileDeleted: boolean;
  restoredForeignContent: boolean;
}

export async function uninstallHook(root: string): Promise<UninstallResult> {
  const target = await resolveHookTarget(root);
  const content = await readHookFile(target.path);

  if (content === null) {
    return { target, removed: false, fileDeleted: false, restoredForeignContent: false };
  }

  const { before, after, found } = splitBlock(content);
  if (!found) {
    return { target, removed: false, fileDeleted: false, restoredForeignContent: false };
  }

  const remaining = `${before}${after}`;
  const body = remaining.replace(/^#!.*\n?/, '').trim();

  // A file containing nothing but a shebang is one we created. Leaving it
  // behind would mean uninstall is not actually reversible.
  if (body.length === 0) {
    await rm(target.path, { force: true });
    return { target, removed: true, fileDeleted: true, restoredForeignContent: false };
  }

  const shebangMatch = /^#!.*\n?/.exec(remaining);
  const shebang = shebangMatch ? shebangMatch[0].trimEnd() : '#!/bin/sh';
  // No blank line between the shebang and the body: uninstall has to return the
  // file to what it was, and "almost" shows up in the user's next git diff.
  await writeFile(target.path, `${shebang}\n${body}\n`, 'utf8');
  return { target, removed: true, fileDeleted: false, restoredForeignContent: true };
}
