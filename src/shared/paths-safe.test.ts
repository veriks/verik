import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveInsideRepo, isInside } from './paths-safe.js';

describe('isInside', () => {
  it('accepts a nested path', () => {
    expect(isInside('/repo', '/repo/src/index.ts')).toBe(true);
  });

  it('accepts the root itself', () => {
    expect(isInside('/repo', '/repo')).toBe(true);
  });

  it('rejects an escaping path', () => {
    expect(isInside('/repo', '/etc/passwd')).toBe(false);
  });

  it('rejects a sibling with a shared prefix', () => {
    // '/repo-secrets' must not count as inside '/repo' just because the string
    // starts with it — this is the classic prefix-matching bug.
    expect(isInside('/repo', '/repo-secrets/keys.pem')).toBe(false);
  });
});

describe('resolveInsideRepo', () => {
  let base: string;
  let repo: string;
  let outsideFile: string;
  let symlinksSupported = true;

  beforeAll(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'cc-paths-')));
    repo = join(base, 'repo');
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'src', 'index.ts'), 'export const x = 1;');

    outsideFile = join(base, 'secrets.txt');
    await writeFile(outsideFile, 'SUPER_SECRET');

    // Windows needs Developer Mode or elevation to create symlinks.
    try {
      await symlink(outsideFile, join(repo, 'escape.txt'));
    } catch {
      symlinksSupported = false;
    }
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('resolves a normal file inside the repo', async () => {
    const resolved = await resolveInsideRepo(repo, 'src/index.ts');
    expect(resolved).not.toBeNull();
    expect(resolved).toContain('index.ts');
  });

  it('rejects a path that traverses out with ..', async () => {
    expect(await resolveInsideRepo(repo, '../secrets.txt')).toBeNull();
  });

  it('rejects an absolute path', async () => {
    expect(await resolveInsideRepo(repo, outsideFile)).toBeNull();
  });

  it('rejects a symlink pointing outside the repo', async () => {
    if (!symlinksSupported) return; // unprivileged Windows
    expect(await resolveInsideRepo(repo, 'escape.txt')).toBeNull();
  });

  it('returns null for a file that does not exist', async () => {
    expect(await resolveInsideRepo(repo, 'src/nope.ts')).toBeNull();
  });
});
