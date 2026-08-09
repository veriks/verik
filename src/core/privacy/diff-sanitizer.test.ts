import { describe, it, expect } from 'vitest';
import {
  sanitizePatch,
  prepareSafePatch,
  splitFileSections,
  pathsInSection,
  truncatePatch,
} from './diff-sanitizer.js';
import { asRawPatch } from './patch-types.js';

const EXCLUDE = ['.env', '.env.*', '**/*.pem', '**/*.key'];

function section(path: string, ...lines: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    'index 0000000000000000000000000000000000000000..1111111111111111111111111111111111111111 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,1 +1,1 @@',
    ...lines,
  ].join('\n');
}

describe('splitFileSections / pathsInSection', () => {
  it('splits on file boundaries and reads paths from the ---/+++ headers', () => {
    const patch = [section('src/a.ts', '+const a = 1'), section('src/b.ts', '+const b = 2')].join(
      '\n',
    );

    const sections = splitFileSections(patch);
    expect(sections).toHaveLength(2);
    expect(pathsInSection(sections[0]!)).toEqual(['src/a.ts']);
  });

  it('reads both sides of a rename', () => {
    const s = [
      'diff --git a/old.ts b/new.ts',
      'similarity index 95%',
      'rename from old.ts',
      'rename to new.ts',
    ].join('\n');

    expect(pathsInSection(s).sort()).toEqual(['new.ts', 'old.ts']);
  });
});

describe('sanitizePatch', () => {
  it('drops an excluded file section entirely', () => {
    const patch = asRawPatch(
      [
        section('.env', '+API_TOKEN=hunter2hunter2hunter2'),
        section('src/a.ts', '+const a = 1'),
      ].join('\n'),
    );

    const result = sanitizePatch(patch, EXCLUDE);

    expect(result.patch).not.toContain('hunter2');
    expect(result.patch).toContain('src/a.ts');
    expect(result.excludedFiles.map((f) => f.path)).toContain('.env');
  });

  it('drops a section that renames away from an excluded path', () => {
    const s = [
      'diff --git a/.env b/config.txt',
      'similarity index 100%',
      'rename from .env',
      'rename to config.txt',
    ].join('\n');

    const result = sanitizePatch(asRawPatch(s), EXCLUDE);
    expect(result.patch).toBe('');
  });

  it('preserves the +/- marker when redacting', () => {
    const key = 'sk-ant-' + 'a1b2c3d4e5'.repeat(4);
    const patch = asRawPatch(section('src/a.ts', `+const key = '${key}'`));

    const result = sanitizePatch(patch, EXCLUDE);
    const hunkLine = result.patch.split('\n').find((l) => l.includes('[REDACTED]'));

    // The long-base64 pattern matches '+' and '/', so redacting the whole line
    // can eat the marker and silently turn an addition into a context line.
    expect(hunkLine?.startsWith('+')).toBe(true);
    expect(result.patch).not.toContain(key);
    expect(result.redactionCount).toBeGreaterThan(0);
  });

  it('leaves structural lines untouched', () => {
    const patch = asRawPatch(section('src/a.ts', '+const a = 1'));
    const result = sanitizePatch(patch, EXCLUDE);

    // The 40-hex blob ids on the `index` line look like base64 to the secret
    // pattern; redacting them corrupts the patch.
    expect(result.patch).toContain(
      'index 0000000000000000000000000000000000000000..1111111111111111111111111111111111111111 100644',
    );
    expect(result.patch).toContain('@@ -1,1 +1,1 @@');
  });

  it('redacts a private key across every line of the block', () => {
    const patch = asRawPatch(
      section(
        'src/key.ts',
        '+-----BEGIN RSA PRIVATE KEY-----',
        '+MIIEowIBAAKCAQEAx7Xq9fQ2mKp3vLnR8sTgY5wZ1aBcDeFgHiJkLmNoPqRsTuVw',
        '+XyZ0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX',
        '+-----END RSA PRIVATE KEY-----',
      ),
    );

    const result = sanitizePatch(patch, EXCLUDE);

    expect(result.patch).not.toContain('MIIEowIBAAKCAQEA');
    expect(result.patch).not.toContain('XyZ0123456789abcdef');
    expect(result.patch).toContain('[REDACTED]');
  });
});

describe('truncatePatch', () => {
  it('drops whole sections rather than slicing mid-hunk', () => {
    const a = section('src/a.ts', '+const a = 1');
    const b = section('src/b.ts', '+const b = 2');
    const patch = [a, b].join('\n');

    const result = truncatePatch(patch, Buffer.byteLength(a) + 1);

    expect(result.truncated).toBe(true);
    expect(result.droppedFiles).toContain('src/b.ts');
    // Every surviving section still starts with a valid header.
    for (const s of splitFileSections(result.patch)) {
      if (s.trim().startsWith('...')) continue;
      expect(s.startsWith('diff --git ')).toBe(true);
    }
  });

  it('is a no-op below the limit', () => {
    const patch = section('src/a.ts', '+const a = 1');
    expect(truncatePatch(patch, 1_000_000)).toMatchObject({ patch, truncated: false });
  });
});

describe('prepareSafePatch', () => {
  it('redacts before truncating', () => {
    const key = 'sk-ant-' + 'z9y8x7w6v5'.repeat(4);
    const kept = section('src/a.ts', `+const key = '${key}'`);
    const dropped = section('src/b.ts', '+const b = 2');
    const patch = asRawPatch([kept, dropped].join('\n'));

    // Sized so the second section is dropped; the first must still be redacted.
    const result = prepareSafePatch(patch, EXCLUDE, Buffer.byteLength(kept) + 1);

    expect(result.truncated).toBe(true);
    expect(result.patch).not.toContain(key);
    expect(result.patch).toContain('[REDACTED]');
    expect(result.droppedFiles).toContain('src/b.ts');
  });

  it('reports exclusions and redactions together', () => {
    const key = 'sk-ant-' + 'q1w2e3r4t5'.repeat(4);
    const patch = asRawPatch(
      [section('.env', '+SECRET=abc'), section('src/a.ts', `+const k = '${key}'`)].join('\n'),
    );

    const result = prepareSafePatch(patch, EXCLUDE, 1_000_000);

    expect(result.excludedFiles.map((f) => f.path)).toEqual(['.env']);
    expect(result.redactionCount).toBe(1);
    expect(result.truncated).toBe(false);
  });
});
