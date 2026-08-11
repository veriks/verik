import { describe, it, expect, afterEach } from 'vitest';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTestRepo, type TestRepo } from '../../__tests__/helpers/test-repo.js';
import {
  installHook,
  uninstallHook,
  readHookStatus,
  resolveHookTarget,
  BEGIN_MARKER,
  END_MARKER,
} from './git-hooks.js';

let repo: TestRepo;
afterEach(async () => {
  await repo?.cleanup();
});

const readHook = async (path: string) => readFile(path, 'utf8');

/**
 * simple-git refuses to *write* core.hooksPath (its unsafe-operations plugin),
 * so the test sets it with git directly. Reading it back through simple-git —
 * which is what the code under test does — is unaffected.
 */
const exec = promisify(execFile);
const setHooksPath = (root: string, value: string) =>
  exec('git', ['-C', root, 'config', 'core.hooksPath', value]);
const countBlocks = (s: string) => s.split(BEGIN_MARKER).length - 1;

describe('resolveHookTarget', () => {
  it('defaults to the repository .git/hooks directory', async () => {
    repo = await createTestRepo();
    const target = await resolveHookTarget(repo.root);
    expect(target.path.replace(/\\/g, '/')).toContain('.git/hooks/pre-commit');
    expect(target.hooksPathOverride).toBeNull();
  });

  it('follows core.hooksPath, which is how husky redirects hooks', async () => {
    // Writing to .git/hooks when this is set produces a file git never runs,
    // and the mistake is completely invisible.
    repo = await createTestRepo();
    await setHooksPath(repo.root, '.husky');
    const target = await resolveHookTarget(repo.root);
    expect(target.hooksPathOverride).toBe('.husky');
    expect(target.path.replace(/\\/g, '/')).toContain('.husky/pre-commit');
  });
});

describe('installHook', () => {
  it('creates a runnable hook when none exists', async () => {
    repo = await createTestRepo();
    const result = await installHook(repo.root);

    const content = await readHook(result.target.path);
    expect(content.startsWith('#!')).toBe(true);
    expect(content).toContain('verik verify --mode rules');
    expect(result.previousState).toBe('absent');

    // Git silently ignores a hook that is not executable. Windows has no
    // executable bit, so this only means anything on POSIX.
    if (process.platform !== 'win32') {
      const mode = (await stat(result.target.path)).mode;
      expect(mode & 0o111).toBeGreaterThan(0);
    }
  });

  it('is idempotent — installing twice leaves one block', async () => {
    repo = await createTestRepo();
    await installHook(repo.root);
    const result = await installHook(repo.root);

    const content = await readHook(result.target.path);
    expect(countBlocks(content)).toBe(1);
    expect(result.previousState).toBe('installed');
  });

  it('honours the mode it was installed with', async () => {
    repo = await createTestRepo();
    const result = await installHook(repo.root, { mode: 'full' });
    expect(await readHook(result.target.path)).toContain('verik verify --mode full');
  });

  it('preserves an existing hook and backs it up', async () => {
    // Most repositories that want this already run husky or lint-staged.
    repo = await createTestRepo();
    const target = await resolveHookTarget(repo.root);
    await mkdir(join(target.dir), { recursive: true });
    await writeFile(target.path, '#!/bin/sh\nnpx lint-staged\n', 'utf8');

    const result = await installHook(repo.root);
    const content = await readHook(target.path);

    expect(content).toContain('npx lint-staged');
    expect(content).toContain(BEGIN_MARKER);
    expect(result.preservedForeignContent).toBe(true);
    expect(result.previousState).toBe('foreign');
    expect(result.backupPath).not.toBeNull();
    expect(await readHook(result.backupPath!)).toBe('#!/bin/sh\nnpx lint-staged\n');
  });

  it('runs after an existing hook by default, so it sees its edits', async () => {
    repo = await createTestRepo();
    const target = await resolveHookTarget(repo.root);
    await mkdir(target.dir, { recursive: true });
    await writeFile(target.path, '#!/bin/sh\nnpx lint-staged\n', 'utf8');

    const result = await installHook(repo.root);
    const content = await readHook(target.path);
    expect(result.position).toBe('append');
    expect(content.indexOf('lint-staged')).toBeLessThan(content.indexOf(BEGIN_MARKER));
  });

  it('installs before a hook that exits unconditionally, and says so', async () => {
    // Appending after `exit 0` produces a block that never runs — a silent
    // failure that looks exactly like a working install.
    repo = await createTestRepo();
    const target = await resolveHookTarget(repo.root);
    await mkdir(target.dir, { recursive: true });
    await writeFile(target.path, '#!/bin/sh\nnpx lint-staged\nexit 0\n', 'utf8');

    const result = await installHook(repo.root);
    const content = await readHook(target.path);

    expect(result.position).toBe('prepend');
    expect(result.warning).toMatch(/never run/i);
    expect(content.indexOf(BEGIN_MARKER)).toBeLessThan(content.indexOf('lint-staged'));
  });

  it('does not overwrite an existing backup on reinstall', async () => {
    repo = await createTestRepo();
    const target = await resolveHookTarget(repo.root);
    await mkdir(target.dir, { recursive: true });
    await writeFile(target.path, '#!/bin/sh\noriginal\n', 'utf8');

    const first = await installHook(repo.root);
    await installHook(repo.root);
    // The backup must stay the pre-verik version, not a copy of our own
    // output from the first install.
    expect(await readHook(first.backupPath!)).toBe('#!/bin/sh\noriginal\n');
  });

  it('creates the hooks directory when core.hooksPath points somewhere absent', async () => {
    repo = await createTestRepo();
    await setHooksPath(repo.root, '.husky');
    const result = await installHook(repo.root);
    expect(await readHook(result.target.path)).toContain(BEGIN_MARKER);
  });
});

describe('uninstallHook', () => {
  it('deletes a hook file that contained only our block', async () => {
    repo = await createTestRepo();
    const { target } = await installHook(repo.root);

    const result = await uninstallHook(repo.root);
    expect(result.removed).toBe(true);
    expect(result.fileDeleted).toBe(true);
    await expect(readHook(target.path)).rejects.toThrow();
  });

  it('leaves the original hook exactly as it was', async () => {
    repo = await createTestRepo();
    const target = await resolveHookTarget(repo.root);
    await mkdir(target.dir, { recursive: true });
    const original = '#!/bin/sh\nnpx lint-staged\n';
    await writeFile(target.path, original, 'utf8');

    await installHook(repo.root);
    const result = await uninstallHook(repo.root);

    expect(result.fileDeleted).toBe(false);
    expect(result.restoredForeignContent).toBe(true);
    expect(await readHook(target.path)).toBe(original);
    expect(await readHook(target.path)).not.toContain('verik');
  });

  it('reports honestly when there is nothing of ours to remove', async () => {
    repo = await createTestRepo();
    const target = await resolveHookTarget(repo.root);
    await mkdir(target.dir, { recursive: true });
    await writeFile(target.path, '#!/bin/sh\nnpx lint-staged\n', 'utf8');

    const result = await uninstallHook(repo.root);
    expect(result.removed).toBe(false);
    expect(await readHook(target.path)).toContain('lint-staged');
  });

  it('does nothing when no hook file exists at all', async () => {
    repo = await createTestRepo();
    expect((await uninstallHook(repo.root)).removed).toBe(false);
  });

  it('round-trips: install then uninstall restores the byte-for-byte original', async () => {
    repo = await createTestRepo();
    const target = await resolveHookTarget(repo.root);
    await mkdir(target.dir, { recursive: true });
    const original = '#!/usr/bin/env bash\nset -e\nnpm run format\n';
    await writeFile(target.path, original, 'utf8');

    await installHook(repo.root);
    await installHook(repo.root, { mode: 'full' });
    await uninstallHook(repo.root);

    expect(await readHook(target.path)).toBe(original);
  });
});

describe('readHookStatus', () => {
  it('distinguishes absent, foreign and installed', async () => {
    repo = await createTestRepo();
    expect((await readHookStatus(repo.root)).state).toBe('absent');

    const target = await resolveHookTarget(repo.root);
    await mkdir(target.dir, { recursive: true });
    await writeFile(target.path, '#!/bin/sh\nnpx lint-staged\n', 'utf8');
    expect((await readHookStatus(repo.root)).state).toBe('foreign');

    await installHook(repo.root);
    const after = await readHookStatus(repo.root);
    expect(after.state).toBe('installed');
    expect(after.hasForeignContent).toBe(true);
  });
});

describe('the generated hook script', () => {
  it('blocks only on a policy verdict, never on a verik failure', async () => {
    repo = await createTestRepo();
    const { target } = await installHook(repo.root);
    const script = await readHook(target.path);

    // 2 = policy block, 3 = blocking mode with no verdict. Anything else is
    // verik's own problem and must not cost the developer their commit.
    expect(script).toContain('2|3)');
    expect(script).toContain('exit 1');
    expect(script).toMatch(/could not complete/);
    expect(script).toContain('--no-verify');
  });

  it('does nothing when verik is not on PATH', async () => {
    repo = await createTestRepo();
    const { target } = await installHook(repo.root);
    expect(await readHook(target.path)).toContain('command -v verik');
  });

  it('is delimited so uninstall can find it exactly', async () => {
    repo = await createTestRepo();
    const { target } = await installHook(repo.root);
    const script = await readHook(target.path);
    expect(script.indexOf(BEGIN_MARKER)).toBeLessThan(script.indexOf(END_MARKER));
  });
});
