import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { createTestRepo, initWithCommit, type TestRepo } from '../helpers/test-repo.js';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { captureSnapshot } from '../../core/repository/repository-snapshot.js';
import { computeDiff } from '../../core/repository/diff-capture.js';

// git returns forward-slash paths on all platforms; normalise for assertions.
const norm = (p: string) => p.replace(/\\/g, '/');

let repo: TestRepo;

afterEach(async () => {
  await repo?.cleanup();
});

describe('attributable diff', () => {
  it('attributes only new files introduced by the wrapped command', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'src/existing.ts', 'export const a = 1;');

    // Simulate a pre-existing dirty file — modified before the command runs.
    await repo.write('src/existing.ts', 'export const a = 2;');

    // Capture baseline — existing.ts is already dirty here.
    const baseline = await captureSnapshot(repo.root, 150_000);

    // The "wrapped command" creates a new file.
    await repo.write('src/new-feature.ts', 'export const b = 1;');

    const diff = await computeDiff(repo.root, baseline, 500_000, true);

    // Only the new file should be attributed to the command.
    expect(diff.commandIntroducedPaths.map(norm)).toContain('src/new-feature.ts');
    expect(diff.commandIntroducedPaths.map(norm)).not.toContain('src/existing.ts');

    // The pre-existing modification should be in preExistingChangedPaths.
    expect(diff.preExistingChangedPaths.map(norm)).toContain('src/existing.ts');
  });

  it('does not attribute pre-existing untracked files to the command', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'README.md', '# hi');

    // Pre-existing untracked file.
    await repo.write('src/pre-existing-untracked.ts', 'export const x = 1;');

    const baseline = await captureSnapshot(repo.root, 150_000);

    // Command creates a different new file.
    await repo.write('src/command-file.ts', 'export const y = 2;');

    const diff = await computeDiff(repo.root, baseline, 500_000, true);

    expect(diff.commandIntroducedPaths.map(norm)).toContain('src/command-file.ts');
    expect(diff.commandIntroducedPaths.map(norm)).not.toContain('src/pre-existing-untracked.ts');
    expect(diff.preExistingChangedPaths.map(norm)).toContain('src/pre-existing-untracked.ts');
  });

  it('returns an empty diff when nothing changed', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'README.md', '# hi');

    const baseline = await captureSnapshot(repo.root, 150_000);
    const diff = await computeDiff(repo.root, baseline, 500_000, true);

    expect(diff.changedFiles).toHaveLength(0);
    expect(diff.commandIntroducedPaths).toHaveLength(0);
    expect(diff.preExistingChangedPaths).toHaveLength(0);
  });

  it('handles new files from the command correctly', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'src/old-name.ts', 'export const z = 1;');

    const baseline = await captureSnapshot(repo.root, 150_000);

    // Command adds a new file.
    await repo.write('src/new-name.ts', 'export const z = 1;');

    const diff = await computeDiff(repo.root, baseline, 500_000, true);

    expect(diff.commandIntroducedPaths.map(norm)).toContain('src/new-name.ts');
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

  it('throws on non-git directory', async () => {
    repo = await createTestRepo();
    await expect(getRepositoryInfo(repo.root)).rejects.toThrow();
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
