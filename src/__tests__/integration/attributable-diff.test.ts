import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { createTestRepo, initWithCommit, type TestRepo } from '../helpers/test-repo.js';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { captureSnapshot } from '../../core/repository/repository-snapshot.js';
import { computeDiff, type DiffResult } from '../../core/repository/diff-capture.js';
import { createTreeWorkspace } from '../../core/repository/worktree-tree.js';

// git returns forward-slash paths on all platforms; normalise for assertions.
const norm = (p: string) => p.replace(/\\/g, '/');

const EXCLUDE = ['.env', '.env.*', '**/*.pem', '**/*.key', '**/credentials.*'];

let repo: TestRepo;

afterEach(async () => {
  await repo?.cleanup();
});

/**
 * Mirrors the orchestrator: snapshot, run the "command", snapshot, diff.
 * Everything the wrapped command did lands in the result; everything that was
 * already dirty is baked into the baseline tree and must not.
 */
async function withCommand(r: TestRepo, command: () => Promise<void>): Promise<DiffResult> {
  const ws = await createTreeWorkspace(r.root);
  try {
    const baseline = await captureSnapshot(r.root, ws, 'baseline');
    await command();
    const final = await captureSnapshot(r.root, ws, 'final');
    return await computeDiff({
      root: r.root,
      workspace: ws,
      baseline,
      final,
      maxDiffBytes: 500_000,
      excludePatterns: EXCLUDE,
    });
  } finally {
    await ws.dispose();
  }
}

describe('attributable diff', () => {
  it('attributes only new files introduced by the wrapped command', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'src/existing.ts', 'export const a = 1;');
    await repo.write('src/existing.ts', 'export const a = 2;');

    const diff = await withCommand(repo, async () => {
      await repo.write('src/new-feature.ts', 'export const b = 1;');
    });

    expect(diff.commandIntroducedPaths.map(norm)).toContain('src/new-feature.ts');
    expect(diff.commandIntroducedPaths.map(norm)).not.toContain('src/existing.ts');
    expect(diff.preExistingChangedPaths.map(norm)).toContain('src/existing.ts');

    // The assertion the path-set version could not make: the pre-existing edit
    // must be absent from the patch, not merely from the file list.
    expect(diff.patch).toContain('src/new-feature.ts');
    expect(diff.patch).not.toContain('export const a = 2;');
  });

  it('attributes a further edit to a file that was already dirty', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'src/shared.ts', 'line one\nline two\nline three\n');

    // Dirty before the command: the user's own uncommitted work.
    await repo.write('src/shared.ts', 'line one EDITED BY USER\nline two\nline three\n');

    const diff = await withCommand(repo, async () => {
      await repo.write('src/shared.ts', 'line one EDITED BY USER\nline two\nline three AGENT\n');
    });

    // Under path-set attribution this file was excluded wholesale, so the
    // agent's edit to it disappeared entirely — the central bug.
    expect(diff.commandIntroducedPaths.map(norm)).toContain('src/shared.ts');
    expect(diff.patch).toContain('line three AGENT');
    // ...and only the agent's hunk, not the user's.
    expect(diff.patch).not.toContain('+line one EDITED BY USER');
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
  });

  it('does not attribute a pre-existing change in a file larger than maxFileBytes', async () => {
    repo = await createTestRepo();
    const big = 'x'.repeat(200_000);
    await initWithCommit(repo, 'src/big.ts', `export const big = "${big}";`);

    // Dirty at baseline, and far above the old 150kB per-file snapshot cap —
    // which silently skipped it, so it was attributed to the command.
    await repo.write('src/big.ts', `export const big = "${big}"; // user edit`);

    const diff = await withCommand(repo, async () => {
      await repo.write('src/other.ts', 'export const o = 1;');
    });

    expect(diff.commandIntroducedPaths.map(norm)).toEqual(['src/other.ts']);
    expect(diff.patch).not.toContain('// user edit');
  });

  it('does not attribute pre-existing untracked files to the command', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'README.md', '# hi');
    await repo.write('src/pre-existing-untracked.ts', 'export const x = 1;');

    const diff = await withCommand(repo, async () => {
      await repo.write('src/command-file.ts', 'export const y = 2;');
    });

    expect(diff.commandIntroducedPaths.map(norm)).toContain('src/command-file.ts');
    expect(diff.commandIntroducedPaths.map(norm)).not.toContain('src/pre-existing-untracked.ts');
    expect(diff.preExistingChangedPaths.map(norm)).toContain('src/pre-existing-untracked.ts');
  });

  it('captures untracked files the command creates, in the patch itself', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'README.md', '# hi');

    const diff = await withCommand(repo, async () => {
      await repo.write('src/brand-new.ts', 'export const n = 1;');
    });

    // `git diff HEAD` never contained untracked files, so the old patch was
    // empty here however includeUntrackedFiles was set.
    expect(diff.patch).toContain('src/brand-new.ts');
    expect(diff.patch).toContain('export const n = 1;');
    expect(diff.changedFiles[0]?.changeType).toBe('added');
  });

  it('records a deletion made by the command', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'src/doomed.ts', 'export const d = 1;');

    const diff = await withCommand(repo, async () => {
      await repo.remove('src/doomed.ts');
    });

    expect(diff.changedFiles.map((f) => f.changeType)).toContain('deleted');
    expect(diff.commandIntroducedPaths.map(norm)).toContain('src/doomed.ts');
  });

  it('returns an empty diff when nothing changed', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'README.md', '# hi');

    const diff = await withCommand(repo, async () => {});

    expect(diff.changedFiles).toHaveLength(0);
    expect(diff.commandIntroducedPaths).toHaveLength(0);
    expect(diff.preExistingChangedPaths).toHaveLength(0);
    expect(diff.patch).toBe('');
  });

  it('never attributes crosscheck run artifacts to the command', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'README.md', '# hi');

    const diff = await withCommand(repo, async () => {
      await repo.write('.crosscheck/runs/ccr_x/metadata.json', '{"runId":"ccr_x"}');
      await repo.write('src/real.ts', 'export const r = 1;');
    });

    expect(diff.commandIntroducedPaths.map(norm)).toEqual(['src/real.ts']);
    expect(diff.patch).not.toContain('.crosscheck');
  });

  it('leaves the repository untouched', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'src/a.ts', 'export const a = 1;');
    await repo.write('src/a.ts', 'export const a = 2;');
    await repo.write('src/untracked.ts', 'export const u = 1;');

    const git = simpleGit(repo.root);
    const before = await git.status();
    const headBefore = (await git.revparse(['HEAD'])).trim();

    await withCommand(repo, async () => {
      await repo.write('src/b.ts', 'export const b = 1;');
    });

    const after = await git.status();
    expect((await git.revparse(['HEAD'])).trim()).toBe(headBefore);
    // The command's own file is the only difference; nothing was staged,
    // stashed or checked out on our behalf.
    expect(after.staged).toEqual(before.staged);
    expect(after.modified).toEqual(before.modified);
    expect(after.not_added.map(norm).filter((p) => p !== 'src/b.ts')).toEqual(
      before.not_added.map(norm),
    );
  });
});

describe('privacy seam', () => {
  it('withholds excluded files from safePatch but keeps them in the raw patch', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, '.env', 'API_TOKEN=old-value-placeholder-1234\n');

    const diff = await withCommand(repo, async () => {
      await repo.write('.env', 'API_TOKEN=super-secret-production-value-9876\n');
      await repo.write('src/ok.ts', 'export const ok = 1;');
    });

    // Attribution still reports the file was touched — withholding content is
    // not the same as pretending nothing happened.
    expect(diff.commandIntroducedPaths.map(norm)).toContain('.env');
    expect(diff.excludedFiles.map((f) => norm(f.path))).toContain('.env');

    expect(diff.patch).toContain('super-secret-production-value-9876');
    expect(diff.safePatch).not.toContain('super-secret-production-value-9876');
    expect(diff.safePatch).toContain('src/ok.ts');
  });

  it('redacts a secret on an added line in a file that is not excluded', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'src/config.ts', 'export const config = {};');

    const key = 'sk-ant-' + 'a1b2c3d4e5'.repeat(4);
    const diff = await withCommand(repo, async () => {
      await repo.write('src/config.ts', `export const config = { apiKey: '${key}' };`);
    });

    expect(diff.patch).toContain(key);
    expect(diff.safePatch).not.toContain(key);
    expect(diff.safePatch).toContain('[REDACTED]');
    expect(diff.redactionCount).toBeGreaterThan(0);
  });
});

describe('getRepositoryInfo', () => {
  it('detects a git repository and returns normalised info', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo);

    const info = await getRepositoryInfo(repo.root);
    // git may return forward slashes on Windows; compare normalised
    expect(norm(info.root)).toBe(norm(repo.root));
    expect(info.isBorn).toBe(true);
    expect(info.commitSha).toHaveLength(40);
  });

  it('throws on a directory that is not a git repository', async () => {
    // createTestRepo() runs `git init`, so it is NOT a non-git directory — the
    // old version of this test was mislabelled and actually asserted the unborn
    // -HEAD throw that has since been removed. Use a genuinely bare directory.
    const bare = join(tmpdir(), `crosscheck-notgit-${Date.now()}`);
    await mkdir(bare, { recursive: true });
    try {
      await expect(getRepositoryInfo(bare)).rejects.toThrow(/not a git repository/i);
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it('treats an unborn HEAD as a supported state, not an error', async () => {
    // `git init` then `crosscheck init` is the first thing a new user does.
    // Every file reads as added against an empty baseline, which is correct for
    // a repository whose first commit has not happened yet.
    repo = await createTestRepo();
    const info = await getRepositoryInfo(repo.root);
    expect(info.isBorn).toBe(false);
    expect(info.commitSha).toBe('');
  });

  it('reports isDirty correctly', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'README.md', '# clean');

    const clean = await getRepositoryInfo(repo.root);
    expect(clean.isDirty).toBe(false);

    await repo.write('README.md', '# dirty');
    const dirty = await getRepositoryInfo(repo.root);
    expect(dirty.isDirty).toBe(true);
  });
});
