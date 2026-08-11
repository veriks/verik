import { describe, it, expect } from 'vitest';
import { SecretLeakRule } from './secret-leak.js';
import { EmptyCatchRule } from './empty-catch.js';
import { DisabledTestsRule } from './disabled-tests.js';
import { iterateAddedLines, iterateRemovedLines, looksLikePlaceholder } from './patch-lines.js';
import { defineLineRule } from './line-rule.js';
import {
  SuppressionAddedRule,
  StubImplementationRule,
  SwallowedErrorRule,
  DebugArtifactRule,
} from './agent-shortcuts.js';
import {
  InsecureTransportRule,
  WeakCryptoRule,
  SqlInjectionRule,
  CommandInjectionRule,
  PermissiveAccessRule,
} from './security-patterns.js';
import {
  CiWorkflowModifiedRule,
  TestRemovalRule,
  TautologicalAssertionRule,
  GitignoreWeakenedRule,
  AuthCheckRemovedRule,
  RiskyDependencySourceRule,
} from './repo-integrity.js';
import { runDeterministicRules, type RuleContext } from './index.js';

const ctx = (patch: string): RuleContext =>
  ({ patch, diff: { changedFiles: [] } }) as unknown as RuleContext;

/** Context for rules that read the file list rather than the patch body. */
const fileCtx = (
  changedFiles: Array<{ path: string; changeType: string }>,
  patch = '',
): RuleContext => ({ patch, diff: { changedFiles } }) as unknown as RuleContext;

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
    expect((await DisabledTestsRule.run(ctx(patch))).length).toBe(3);
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

describe('iterateRemovedLines', () => {
  it('numbers removals against the old side of the file', () => {
    const patch = hunk('src/a.ts', 20, ['-gone', ' kept', '-also gone']);
    const got = [...iterateRemovedLines(patch)].map((l) => `${l.path}:${l.line}:${l.text}`);
    expect(got).toEqual(['src/a.ts:20:gone', 'src/a.ts:22:also gone']);
  });

  it('does not treat the --- header as a removed line', () => {
    expect([...iterateRemovedLines(hunk('a.ts', 1, ['-real']))]).toHaveLength(1);
  });

  it('attributes removals in a deleted file to its old path', () => {
    const patch = [
      'diff --git a/old.ts b/old.ts',
      '--- a/old.ts',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-export const x = 1;',
    ].join('\n');
    expect([...iterateRemovedLines(patch)][0]!.path).toBe('old.ts');
  });

  it('keeps both sides independent when a hunk edits in place', () => {
    const patch = hunk('a.ts', 5, [' ctx', '-old', '+new', ' ctx2']);
    expect([...iterateRemovedLines(patch)][0]!.line).toBe(6);
    expect([...iterateAddedLines(patch)][0]!.line).toBe(6);
  });
});

describe('defineLineRule', () => {
  it('refuses a global regex at construction', () => {
    // The /g + .test() combination silently matched every second occurrence.
    // Rejecting it here means the bug cannot be reintroduced by a new rule.
    expect(() =>
      defineLineRule({
        id: 'bad',
        title: 'bad',
        severity: 'low',
        confidence: 1,
        message: '',
        remediation: '',
        patterns: [/sk-\w+/g],
      }),
    ).toThrow(/g and y flags/);
  });

  it('ignores a line that is only a regex or string literal', async () => {
    // A pattern table or test fixture contains the thing being detected. This
    // is the difference between scanning a security tool's source and finding
    // twenty bugs in it.
    const patch = hunk('src/patterns.ts', 1, [
      '+    /rejectUnauthorized\\s*:\\s*false/,',
      "+      '  } catch (e) {}',",
      '+    "postinstall",',
    ]);
    expect(await InsecureTransportRule.run(ctx(patch))).toHaveLength(0);
    expect(await SwallowedErrorRule.run(ctx(patch))).toHaveLength(0);
  });

  it('ignores prose describing a hazard, but not the hazard', async () => {
    const prose = hunk('src/a.ts', 1, [
      '+ * `Math.random()` for a token is fine to mention in a comment',
      '+// set rejectUnauthorized: false to skip verification',
    ]);
    expect(await WeakCryptoRule.run(ctx(prose))).toHaveLength(0);
    expect(await InsecureTransportRule.run(ctx(prose))).toHaveLength(0);

    const real = hunk('src/a.ts', 1, ['+  const opts = { rejectUnauthorized: false };']);
    expect(await InsecureTransportRule.run(ctx(real))).toHaveLength(1);
  });

  it('still reads comments for rules whose subject is a comment', async () => {
    const patch = hunk('src/a.ts', 1, ['+// eslint-disable-next-line no-eval']);
    expect(await SuppressionAddedRule.run(ctx(patch))).toHaveLength(1);
  });

  it('caps findings so one pathological diff cannot flood the report', async () => {
    const patch = hunk(
      'a.ts',
      1,
      Array.from({ length: 50 }, (_, i) => `+console.log(${i});`),
    );
    expect((await DebugArtifactRule.run(ctx(patch))).length).toBeLessThanOrEqual(8);
  });
});

describe('agent shortcut rules', () => {
  it('flags a suppression comment across ecosystems', async () => {
    const patch = hunk('a.ts', 1, [
      '+// eslint-disable-next-line no-unused-vars',
      '+x = 1  # noqa',
      '+y = 2  # type: ignore',
      '+// @ts-ignore',
    ]);
    expect(await SuppressionAddedRule.run(ctx(patch))).toHaveLength(4);
  });

  it('ignores prettier-ignore and re-enabling comments', async () => {
    const patch = hunk('a.ts', 1, ['+// prettier-ignore', '+/* eslint-enable no-console */']);
    expect(await SuppressionAddedRule.run(ctx(patch))).toHaveLength(0);
  });

  it('flags an unimplemented path but not an ordinary TODO', async () => {
    const real = hunk('a.ts', 1, [
      "+  throw new Error('Not implemented');",
      '+    raise NotImplementedError',
      '+    todo!()',
    ]);
    expect(await StubImplementationRule.run(ctx(real))).toHaveLength(3);

    const ordinary = hunk('a.ts', 1, ['+// TODO: rename this later', '+// FIXME tidy up']);
    expect(await StubImplementationRule.run(ctx(ordinary))).toHaveLength(0);
  });

  it('flags single-line error swallowing', async () => {
    const patch = hunk('a.py', 1, [
      '+except Exception: pass',
      '+  } catch (e) {}',
      '+  promise.catch(() => {})',
    ]);
    expect((await SwallowedErrorRule.run(ctx(patch))).length).toBe(3);
  });

  it('leaves debug output alone in tests and scripts', async () => {
    for (const path of ['src/a.test.ts', 'scripts/build.ts', 'test/helper.ts']) {
      const patch = hunk(path, 1, ['+console.log("x");']);
      expect(await DebugArtifactRule.run(ctx(patch))).toHaveLength(0);
    }
    expect(
      await DebugArtifactRule.run(ctx(hunk('src/app.ts', 1, ['+console.log("x");']))),
    ).toHaveLength(1);
  });
});

describe('security rules', () => {
  it('flags disabled TLS verification in source but not in tests', async () => {
    const lines = ['+  rejectUnauthorized: false,', '+r = requests.get(u, verify=False)'];
    expect(await InsecureTransportRule.run(ctx(hunk('src/http.ts', 1, lines)))).toHaveLength(2);
    expect(await InsecureTransportRule.run(ctx(hunk('src/http.test.ts', 1, lines)))).toHaveLength(
      0,
    );
  });

  it('flags weak hashes and predictable randomness used as a secret', async () => {
    const patch = hunk('src/a.ts', 1, [
      "+const h = createHash('md5').update(pw);",
      '+const token = Math.random().toString(36);',
    ]);
    expect(await WeakCryptoRule.run(ctx(patch))).toHaveLength(2);
  });

  it('does not flag Math.random used for something harmless', async () => {
    const patch = hunk('src/a.ts', 1, ['+const jitter = Math.random() * 100;']);
    expect(await WeakCryptoRule.run(ctx(patch))).toHaveLength(0);
  });

  it('flags interpolated SQL but not a parameterised query', async () => {
    const bad = hunk('src/db.ts', 1, ['+db.query(`SELECT * FROM users WHERE id = ${id}`)']);
    expect(await SqlInjectionRule.run(ctx(bad))).toHaveLength(1);

    const good = hunk('src/db.ts', 1, ["+db.query('SELECT * FROM users WHERE id = ?', [id])"]);
    expect(await SqlInjectionRule.run(ctx(good))).toHaveLength(0);
  });

  it('flags a shell invoked with interpolation', async () => {
    const patch = hunk('src/a.py', 1, [
      '+subprocess.run(cmd, shell=True)',
      '+os.system(f"rm {path}")',
    ]);
    expect(await CommandInjectionRule.run(ctx(patch))).toHaveLength(2);
  });

  it('flags wildcarded access control', async () => {
    const patch = hunk('src/server.ts', 1, [
      "+  res.setHeader('Access-Control-Allow-Origin', '*');",
      '+  chmod 777 /data',
    ]);
    expect((await PermissiveAccessRule.run(ctx(patch))).length).toBe(2);
  });
});

describe('repo integrity rules', () => {
  it('flags a CI workflow change, and harder when it is a deletion', async () => {
    const modified = await CiWorkflowModifiedRule.run(
      fileCtx([{ path: '.github/workflows/ci.yml', changeType: 'modified' }]),
    );
    expect(modified[0]!.severity).toBe('medium');

    const deleted = await CiWorkflowModifiedRule.run(
      fileCtx([{ path: '.github/workflows/ci.yml', changeType: 'deleted' }]),
    );
    expect(deleted[0]!.severity).toBe('high');
  });

  it("flags a change to verik's own policy file", async () => {
    const found = await CiWorkflowModifiedRule.run(
      fileCtx([{ path: '.verik/policy.json', changeType: 'modified' }]),
    );
    expect(found).toHaveLength(1);
  });

  it('flags a deleted test file', async () => {
    const found = await TestRemovalRule.run(
      fileCtx([{ path: 'src/auth.test.ts', changeType: 'deleted' }]),
    );
    expect(found[0]!.severity).toBe('high');
  });

  it('reports removed assertions once per file, not once per line', async () => {
    const patch = hunk('src/a.test.ts', 1, [
      '-  expect(user.isAdmin).toBe(false);',
      '-  expect(res.status).toBe(403);',
      '-  assert.equal(x, 1);',
    ]);
    const found = (await TestRemovalRule.run(fileCtx([], patch))).filter(
      (f) => f.title === 'Assertions removed from a test',
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('3 more assertions');
  });

  it('does not report a test whose assertions were rewritten, not dropped', async () => {
    // A refactor removes an assertion line and adds one back. Only a net loss
    // of coverage is a finding.
    const patch = hunk('src/a.test.ts', 1, [
      '-  expect(x).toBe(1);',
      '+  expect(x).toStrictEqual(1);',
    ]);
    expect(await TestRemovalRule.run(fileCtx([], patch))).toHaveLength(0);
  });

  it('ignores removed assertions outside test files', async () => {
    const patch = hunk('src/app.ts', 1, ['-  assert(x);']);
    expect(await TestRemovalRule.run(fileCtx([], patch))).toHaveLength(0);
  });

  it('flags an assertion that cannot fail', async () => {
    // The counting check above sees a net change of zero here, so shape is the
    // only thing that catches a test being neutered rather than deleted.
    const patch = hunk('src/a.test.ts', 1, [
      '+  expect(true).toBe(true);',
      '+  assert True',
      '+  expect(count).toEqual(count);',
    ]);
    expect(await TautologicalAssertionRule.run(ctx(patch))).toHaveLength(3);
  });

  it('does not flag a real assertion', async () => {
    const patch = hunk('src/a.test.ts', 1, [
      '+  expect(user.isAdmin).toBe(false);',
      '+  expect(found.length).toBe(3);',
      '+  expect(Array.isArray(x)).toBe(true);',
    ]);
    expect(await TautologicalAssertionRule.run(ctx(patch))).toHaveLength(0);
  });

  it('flags a removed .gitignore entry but not a removed comment', async () => {
    const patch = hunk('.gitignore', 1, ['-.env', '-# a comment', '-*.pem']);
    const found = await GitignoreWeakenedRule.run(ctx(patch));
    expect(found.map((f) => f.excerpt)).toEqual(['.env', '*.pem']);
  });

  it('flags a removed authorisation check', async () => {
    const patch = hunk('src/route.ts', 1, ['-  if (!isAuthorized(user)) return res.status(403);']);
    expect(await AuthCheckRemovedRule.run(ctx(patch))).toHaveLength(1);
  });

  it('flags install hooks and non-registry dependency sources', async () => {
    const patch = hunk('package.json', 1, [
      '+    "postinstall": "node ./setup.js",',
      '+    "some-lib": "git+https://example.com/x.git"',
    ]);
    expect(await RiskyDependencySourceRule.run(ctx(patch))).toHaveLength(2);
  });

  it('does not flag an ordinary version bump', async () => {
    const patch = hunk('package.json', 1, ['+    "zod": "^3.23.8",']);
    expect(await RiskyDependencySourceRule.run(ctx(patch))).toHaveLength(0);
  });
});

describe('runDeterministicRules', () => {
  it('returns the most severe findings first', async () => {
    const patch = hunk('src/a.ts', 1, [
      '+console.log("debug");',
      '+  rejectUnauthorized: false,',
      '+// eslint-disable-next-line',
    ]);
    const found = await runDeterministicRules(fileCtx([], patch));
    expect(found[0]!.severity).toBe('critical');
    expect(found.map((f) => f.ruleId)).toContain('debug-artifact');
  });

  it('survives a rule that throws', async () => {
    // A malformed patch must not take the pipeline down with it.
    const found = await runDeterministicRules(fileCtx([], 'not a diff at all'));
    expect(Array.isArray(found)).toBe(true);
  });
});
