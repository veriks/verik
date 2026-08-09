import { describe, it, expect, afterEach } from 'vitest';
import { createTestRepo, initWithCommit, type TestRepo } from '../helpers/test-repo.js';
import { detectProject } from '../../stages/builder/project-detector.js';
import { planCommands } from '../../stages/builder/command-planner.js';

let repo: TestRepo;

afterEach(async () => {
  await repo?.cleanup();
});

describe('project detection', () => {
  it('detects a Node.js project with pnpm', async () => {
    repo = await createTestRepo();
    await repo.write('package.json', JSON.stringify({
      name: 'test',
      scripts: { test: 'vitest', typecheck: 'tsc --noEmit', build: 'tsc', lint: 'eslint src' },
    }));
    await repo.write('pnpm-lock.yaml', '');
    await initWithCommit(repo);

    const detection = detectProject(repo.root);
    expect(detection.projectTypes).toContain('node');
    expect(detection.packageManager).toBe('pnpm');
  });

  it('detects npm without lockfile present', async () => {
    repo = await createTestRepo();
    await repo.write('package.json', JSON.stringify({ name: 'test', scripts: { test: 'jest' } }));
    await initWithCommit(repo);

    const detection = detectProject(repo.root);
    expect(detection.projectTypes).toContain('node');
    // No lockfile present — package manager should be null, not crash
    expect(detection.packageManager).toBeNull();
  });

  it('detects Python project', async () => {
    repo = await createTestRepo();
    await repo.write('requirements.txt', 'requests\npytest\n');
    await initWithCommit(repo);

    const detection = detectProject(repo.root);
    expect(detection.projectTypes).toContain('python');
  });

  it('falls back to generic for unknown project type', async () => {
    repo = await createTestRepo();
    await repo.write('main.go', 'package main\n');
    await initWithCommit(repo);

    const detection = detectProject(repo.root);
    expect(detection.projectTypes).toContain('generic');
  });
});

describe('command planner', () => {
  it('plans typecheck, test, lint from package.json scripts', () => {
    const detection = {
      projectTypes: ['node'] as ['node'],
      packageManager: 'pnpm' as const,
      hasLockfile: true,
      scripts: { test: 'vitest', typecheck: 'tsc --noEmit', lint: 'eslint src' },
    };

    const planned = planCommands(detection, []);
    const names = planned.map((p) => p.name);
    expect(names).toContain('typecheck');
    expect(names).toContain('test');
    expect(names).toContain('lint');
  });

  it('uses the correct package manager prefix', () => {
    const detection = {
      projectTypes: ['node'] as ['node'],
      packageManager: 'yarn' as const,
      hasLockfile: true,
      scripts: { test: 'jest' },
    };

    const planned = planCommands(detection, []);
    expect(planned[0]?.command).toMatch(/^yarn/);
  });

  it('adds extra configured commands without duplicating existing ones', () => {
    const detection = {
      projectTypes: ['node'] as ['node'],
      packageManager: 'npm' as const,
      hasLockfile: true,
      scripts: { test: 'jest' },
    };

    const planned = planCommands(detection, [
      { name: 'test', command: 'npm test' },          // duplicate — should be skipped
      { name: 'custom-check', command: 'node check.js' },
    ]);

    const names = planned.map((p) => p.name);
    expect(names.filter((n) => n === 'test')).toHaveLength(1);
    expect(names).toContain('custom-check');
  });

  it('returns empty list for generic projects with no extra commands', () => {
    const detection = {
      projectTypes: ['generic'] as ['generic'],
      packageManager: null,
      hasLockfile: false,
      scripts: {},
    };

    const planned = planCommands(detection, []);
    expect(planned).toHaveLength(0);
  });
});
