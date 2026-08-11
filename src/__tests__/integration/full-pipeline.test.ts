import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { createTestRepo, initWithCommit, type TestRepo } from '../helpers/test-repo.js';
import { orchestrateRun } from '../../core/run/run-orchestrator.js';

// git returns forward-slash paths on all platforms; normalise for assertions.
const norm = (p: string) => p.replace(/\\/g, '/');

let repo: TestRepo;

afterEach(async () => {
  await repo?.cleanup();
});

/**
 * Full-pipeline smoke tests using FakeProvider.
 * LLM stages (Scout, Reviewer, Judge) will fail gracefully and produce
 * inconclusive results — expected without an API key.
 * What we validate: subprocess execution, diff capture, report writing, exit codes.
 */
describe('orchestrateRun', () => {
  it('runs a command, captures changed files, writes report and metadata', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'src/index.ts', 'export const x = 1;');

    // Script must create the src/ dir before writing — the dir already exists
    // after initWithCommit, but make it explicit for clarity.
    await repo.write(
      'scripts/add-file.js',
      [
        "const fs = require('fs');",
        "const path = require('path');",
        "const dir = path.join(process.cwd(), 'src');",
        'if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });',
        "fs.writeFileSync(path.join(dir, 'generated.ts'), 'export const g = 42;');",
      ].join('\n'),
    );

    const result = await orchestrateRun(['node', 'scripts/add-file.js'], repo.root, {
      json: false,
      quiet: true,
      verbose: false,
      noBuilder: false,
    });

    expect(result.runId).toMatch(/^vk_/);
    expect(norm(result.repoRoot)).toBe(norm(repo.root));

    const metaPath = join(repo.root, '.verik', 'runs', result.runId, 'metadata.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as {
      changedFiles: string[];
      commandIntroducedPaths: string[];
    };
    expect(meta.changedFiles.map(norm)).toContain('src/generated.ts');
    expect(meta.commandIntroducedPaths.map(norm)).toContain('src/generated.ts');

    // Report files must exist.
    await expect(
      access(join(repo.root, '.verik', 'runs', result.runId, 'report.md')),
    ).resolves.toBeUndefined();
    await expect(
      access(join(repo.root, '.verik', 'runs', result.runId, 'report.json')),
    ).resolves.toBeUndefined();
  }, 15000);

  it('exits cleanly when command produces no changes', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'README.md', '# hi');

    const result = await orchestrateRun(['node', '-e', ''], repo.root, {
      json: false,
      quiet: true,
      verbose: false,
      noBuilder: false,
    });

    expect(result.runId).toMatch(/^vk_/);
    expect(result.exitCode).toBe(0);
  });

  it('records wrapped command exit code and still verifies changes when command fails', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'README.md', '# hi');

    // Script writes a file and then exits non-zero.
    await repo.write(
      'scripts/fail.js',
      [
        "const fs = require('fs');",
        "const path = require('path');",
        "const dir = path.join(process.cwd(), 'src');",
        'if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });',
        "fs.writeFileSync(path.join(dir, 'fail-output.ts'), 'export const f = 1;');",
        'process.exit(1);',
      ].join('\n'),
    );

    const result = await orchestrateRun(['node', 'scripts/fail.js'], repo.root, {
      json: false,
      quiet: true,
      verbose: false,
      noBuilder: false,
    });

    const metaPath = join(repo.root, '.verik', 'runs', result.runId, 'metadata.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as {
      wrappedCommandExitCode: number;
      changedFiles: string[];
    };
    expect(meta.wrappedCommandExitCode).toBe(1);
    expect(meta.changedFiles.map(norm)).toContain('src/fail-output.ts');
  });

  it('does not attribute pre-existing changes to the wrapped command', async () => {
    repo = await createTestRepo();
    await initWithCommit(repo, 'src/auth.ts', 'export const auth = () => {};');

    // Pre-existing dirty file.
    await repo.write('src/auth.ts', 'export const auth = () => { /* modified */ };');

    // Command adds a different file.
    await repo.write(
      'scripts/add.js',
      [
        "const fs = require('fs');",
        "const path = require('path');",
        "const dir = path.join(process.cwd(), 'src');",
        'if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });',
        "fs.writeFileSync(path.join(dir, 'new.ts'), 'export const n = 1;');",
      ].join('\n'),
    );

    const result = await orchestrateRun(['node', 'scripts/add.js'], repo.root, {
      json: false,
      quiet: true,
      verbose: false,
      noBuilder: false,
    });

    const metaPath = join(repo.root, '.verik', 'runs', result.runId, 'metadata.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as {
      commandIntroducedPaths: string[];
      preExistingChangedPaths: string[];
    };

    expect(meta.commandIntroducedPaths.map(norm)).toContain('src/new.ts');
    expect(meta.commandIntroducedPaths.map(norm)).not.toContain('src/auth.ts');
    expect(meta.preExistingChangedPaths.map(norm)).toContain('src/auth.ts');
  });
});
