import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

/**
 * Whether a command's executable can actually be found.
 *
 * This matters because a missing tool is otherwise indistinguishable from a
 * failing one. On Windows, cross-spawn routes an unresolvable command through
 * cmd.exe, which exits 1 with "'pnpm' is not recognized…" — byte-for-byte the
 * same shape as a genuine test failure. The Builder then reports "3 failure(s)"
 * and the Judge reasonably concludes the code is broken, when in truth nothing
 * was ever checked.
 *
 * Distinguishing "your build failed" from "I could not run your build" is the
 * difference between evidence and noise, so it is worth resolving up front
 * rather than pattern-matching a locale-dependent error string afterwards.
 */
export function canExecute(bin: string): boolean {
  // A path-qualified command is checked directly; PATH is not consulted.
  if (bin.includes('/') || bin.includes('\\') || isAbsolute(bin)) {
    return isExecutableFile(bin) || windowsVariants(bin).some(isExecutableFile);
  }

  const pathEntries = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean);
  for (const dir of pathEntries) {
    const candidate = join(dir, bin);
    if (isExecutableFile(candidate)) return true;
    if (windowsVariants(candidate).some(isExecutableFile)) return true;
  }
  return false;
}

/**
 * On Windows the executable is `pnpm.cmd`, not `pnpm`. PATHEXT lists the
 * suffixes the shell would try, and its default is not guaranteed to be set.
 */
function windowsVariants(base: string): string[] {
  if (process.platform !== 'win32') return [];
  const exts = (process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  return exts.map((ext) => base + ext.toLowerCase());
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
  } catch {
    return false;
  }
  // X_OK is meaningless on Windows — presence of the file is the real test.
  if (process.platform === 'win32') return true;
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
