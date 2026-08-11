import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDotenv, loadDotenv } from './dotenv.js';

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
  delete process.env['DOTENV_TEST_KEY'];
  delete process.env['DOTENV_TEST_EXISTING'];
});

describe('parseDotenv', () => {
  it('reads plain, quoted and exported forms', () => {
    expect(parseDotenv(['A=1', 'B="two"', "C='three'", 'export D=4'].join('\n'))).toEqual({
      A: '1',
      B: 'two',
      C: 'three',
      D: '4',
    });
  });

  it('ignores comments and blank lines', () => {
    expect(parseDotenv('# note\n\nA=1\n')).toEqual({ A: '1' });
  });

  it('keeps a # that is inside quotes', () => {
    // API keys and passwords contain '#'. Treating it as a comment truncates
    // the value and produces an authentication error nobody can explain.
    expect(parseDotenv('A="sk-with#hash"').A).toBe('sk-with#hash');
    expect(parseDotenv('B=plain # trailing note').B).toBe('plain');
  });

  it('keeps = inside a value', () => {
    expect(parseDotenv('A=base64==').A).toBe('base64==');
  });
});

describe('loadDotenv', () => {
  it('is silent when there is no file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dotenv-'));
    expect(await loadDotenv(dir)).toBe(0);
  });

  it('applies values to process.env', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dotenv-'));
    await writeFile(join(dir, '.env'), 'DOTENV_TEST_KEY=from-file\n');
    await loadDotenv(dir);
    expect(process.env['DOTENV_TEST_KEY']).toBe('from-file');
  });

  it('never overrides a variable already set', async () => {
    // An explicit `VERIK_API_KEY=... verik verify` must beat a stale file, and
    // CI secrets must beat anything checked out.
    process.env['DOTENV_TEST_EXISTING'] = 'from-shell';
    dir = await mkdtemp(join(tmpdir(), 'dotenv-'));
    await writeFile(join(dir, '.env'), 'DOTENV_TEST_EXISTING=from-file\n');
    await loadDotenv(dir);
    expect(process.env['DOTENV_TEST_EXISTING']).toBe('from-shell');
  });
});
