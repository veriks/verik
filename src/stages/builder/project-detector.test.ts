import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectProject } from './project-detector.js';
import { planCommands } from './command-planner.js';
import { validateBuilderCommand } from './command-allowlist.js';

let base: string;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'cc-detect-'));
});
afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

/** Builds a throwaway project from a set of marker files. */
async function project(name: string, files: Record<string, string>): Promise<string> {
  const dir = join(base, name);
  await mkdir(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    await writeFile(join(dir, file), content, 'utf8');
  }
  return dir;
}

describe('detectProject', () => {
  it.each([
    ['go', { 'go.mod': 'module x' }],
    ['rust', { 'Cargo.toml': '[package]' }],
    ['java-maven', { 'pom.xml': '<project/>' }],
    ['java-gradle', { 'build.gradle.kts': '' }],
    ['ruby', { Gemfile: 'source "x"' }],
    ['php', { 'composer.json': '{}' }],
    ['dotnet', { 'App.csproj': '<Project/>' }],
    ['python', { 'pyproject.toml': '[project]' }],
    ['node', { 'package.json': '{}' }],
  ])('detects %s', async (type, files) => {
    const dir = await project(`t-${type}`, files);
    expect(detectProject(dir).projectTypes).toContain(type);
  });

  it('reports every ecosystem in a polyglot repo rather than picking one', async () => {
    // A Go service with a TypeScript frontend is one repo, two ecosystems.
    const dir = await project('poly', { 'go.mod': 'module x', 'package.json': '{}' });
    const types = detectProject(dir).projectTypes;
    expect(types).toContain('go');
    expect(types).toContain('node');
    expect(types).not.toContain('generic');
  });

  it('falls back to generic and says so', async () => {
    const dir = await project('empty', { 'README.md': 'hi' });
    expect(detectProject(dir).projectTypes).toEqual(['generic']);
    expect(planCommands(detectProject(dir), [])).toHaveLength(0);
  });

  it('only plans python tools the project has configured', async () => {
    const bare = await project('py-bare', { 'requirements.txt': '' });
    const names = planCommands(detectProject(bare), []).map((c) => c.name);
    // Running ruff on a repo that never configured it produces noise, not evidence.
    expect(names).toContain('pytest');
    expect(names).not.toContain('ruff');
    expect(names).not.toContain('mypy');

    const configured = await project('py-full', {
      'pyproject.toml': '[tool.ruff]\n[tool.mypy]\n',
    });
    const full = planCommands(detectProject(configured), []).map((c) => c.name);
    expect(full).toEqual(expect.arrayContaining(['pytest', 'ruff', 'mypy']));
  });

  it('prefers the gradle wrapper when present', async () => {
    const withWrapper = await project('gw', { 'build.gradle': '', gradlew: '' });
    const cmd = planCommands(detectProject(withWrapper), [])[0]!.command;
    expect(cmd).toMatch(/gradlew/);

    const without = await project('gnw', { 'build.gradle': '' });
    expect(planCommands(detectProject(without), [])[0]!.command).toMatch(/^gradle /);
  });

  it('every planned command survives the allowlist', async () => {
    // Planned commands are compile-time constants and bypass validation, so a
    // shell operator sneaking in would never be caught at runtime.
    const dir = await project('all', {
      'go.mod': 'module x',
      'Cargo.toml': '[package]',
      'pom.xml': '<project/>',
      'build.gradle': '',
      Gemfile: '',
      'composer.json': '{}',
      'App.csproj': '',
      'pyproject.toml': '[tool.ruff]\n[tool.mypy]\n',
      'package.json': '{"scripts":{"test":"vitest","lint":"eslint","typecheck":"tsc"}}',
    });
    for (const c of planCommands(detectProject(dir), [])) {
      expect(() => validateBuilderCommand(c.name, c.command)).not.toThrow();
    }
  });
});
