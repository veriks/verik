import { describe, it, expect } from 'vitest';
import { SecretLeakRule } from './secret-leak.js';
import { EmptyCatchRule, DisabledTestsRule } from './env-file.js';
import { iterateAddedLines, looksLikePlaceholder } from './patch-lines.js';
import type { RuleContext } from './index.js';

const ctx = (patch: string): RuleContext =>
  ({ patch, diff: { changedFiles: [] } }) as unknown as RuleContext;

const hunk = (path: string, start: number, lines: string[]): string =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${start},0 +${start},${lines.length} @@`,
    ...lines,
  ].join('\n');

describe('iterateAddedLines', () => {
  it('reports the real path and line for each added line', () => {
    const patch = hunk('src/a.ts', 10, ['+one', ' context', '+two']);
    const got = [...iterateAddedLines(patch)].map((a) => `${a.path}:${a.line}:${a.text}`);
    // Line 10 is the first added line; the context line advances the counter.
    expect(got).toEqual(['src/a.ts:10:one', 'src/a.ts:12:two']);
  });

  it('keeps files separate', () => {
    const patch = `${hunk('a.ts', 1, ['+x'])}\n${hunk('b.ts', 5, ['+y'])}`;
    const got = [...iterateAddedLines(patch)].map((a) => `${a.path}:${a.line}`);
    expect(got).toEqual(['a.ts:1', 'b.ts:5']);
  });

  it('does not treat the +++ header as an added line', () => {
    const got = [...iterateAddedLines(hunk('a.ts', 1, ['+real']))];
    expect(got).toHaveLength(1);
    expect(got[0]!.text).toBe('real');
  });
});

describe('SecretLeakRule', () => {
  it('finds every secret, not every other one', async () => {
    // Regression: the patterns were /g and matched with .test(), which advances
    // lastIndex on a shared module-level regex — so alternate lines were missed.
    const patch = hunk('src/a.ts', 1, [
      '+const a = "sk-aaaaaaaaaaaaaaaaaaaa";',
      '+const b = "sk-bbbbbbbbbbbbbbbbbbbb";',
      '+const c = "sk-cccccccccccccccccccc";',
      '+const d = "sk-dddddddddddddddddddd";',
    ]);
    const found = await new SecretLeakRule().run(ctx(patch));
    expect(found).toHaveLength(4);
  });

  it('reports a real file and line', async () => {
    const patch = hunk('src/config.ts', 7, ['+const k = "sk-abcdefghijklmnop";']);
    const [finding] = await new SecretLeakRule().run(ctx(patch));
    expect(finding!.file).toBe('src/config.ts');
    expect(finding!.line).toBe(7);
  });

  it('never echoes the secret into the excerpt', async () => {
    // The excerpt reaches reports and memory, and memory becomes team-shared.
    const patch = hunk('a.ts', 1, ['+const k = "sk-supersecretvalue123";']);
    const [finding] = await new SecretLeakRule().run(ctx(patch));
    expect(finding!.excerpt).not.toContain('sk-supersecretvalue123');
    expect(finding!.excerpt).toContain('[REDACTED]');
  });

  it('ignores placeholders — blocking a build on a fixture is worse than a miss', async () => {
    const patch = hunk('test/fixtures.ts', 1, [
      '+const password = "changeme";',
      '+const apiKey = "your-api-key-here";',
      '+const token = "REPLACE_ME";',
      '+const secret = "${VAULT_SECRET}";',
      '+const pw = "xxxxxxxxxxxx";',
    ]);
    expect(await new SecretLeakRule().run(ctx(patch))).toHaveLength(0);
  });

  it('still catches a real credential assignment', async () => {
    const patch = hunk('a.ts', 1, ['+const password = "hunter2-J8x!vQ2z";']);
    expect(await new SecretLeakRule().run(ctx(patch))).toHaveLength(1);
  });
});

describe('EmptyCatchRule', () => {
  it('does not pair a catch in one file with a brace in the next', async () => {
    // Regression: added lines were flattened across the whole patch, so these
    // two unrelated files produced a finding.
    const patch = `${hunk('a.ts', 1, ['+try { x() } catch (e) {'])}\n${hunk('b.ts', 1, ['+}'])}`;
    expect(await new EmptyCatchRule().run(ctx(patch))).toHaveLength(0);
  });

  it('still catches a genuinely empty catch', async () => {
    const patch = hunk('a.ts', 1, ['+  } catch (e) {', '+  }']);
    const found = await new EmptyCatchRule().run(ctx(patch));
    expect(found).toHaveLength(1);
    expect(found[0]!.file).toBe('a.ts');
  });
});

describe('DisabledTestsRule', () => {
  it('covers non-JavaScript ecosystems', async () => {
    const patch = hunk('t.py', 1, ['+@pytest.mark.skip', '+@Ignore', '+t.Skip("wip")']);
    expect((await new DisabledTestsRule().run(ctx(patch))).length).toBe(3);
  });
});

describe('looksLikePlaceholder', () => {
  it.each(['changeme', 'YOUR_TOKEN', '<your-key>', '${SECRET}', 'process.env.KEY', 'xxxxxxxx', ''])(
    'treats %s as a placeholder',
    (v) => expect(looksLikePlaceholder(v)).toBe(true),
  );

  it.each(['hunter2-J8x!vQ2z', 'AKIA1234567890ABCD'])('treats %s as real', (v) =>
    expect(looksLikePlaceholder(v)).toBe(false),
  );
});
