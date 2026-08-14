import type { DeterministicFinding, DeterministicRule, RuleContext } from './index.js';
import { iteratePatchLines } from './patch-lines.js';
import { isSourcePath } from './file-kinds.js';

/**
 * Skip markers added to a suite.
 *
 * The distinction that matters is guarded versus unguarded. A skip behind a
 * condition is ordinary engineering — platform gates, version gates, "no
 * network in CI" — and every real suite has them. An unguarded skip is a test
 * someone switched off.
 *
 * Python spells the guarded form as a decorator, so `skipif` is simply excluded.
 * Go and JavaScript spell it as a conditional block:
 *
 *     if runtime.GOOS == "windows" {
 *         t.Skip("go tool nm fails on windows")
 *     }
 *
 * which is indistinguishable from a disabled test on the marker line alone.
 * Both were reported against real repositories — cobra's platform skip and
 * requests' skipif — so the rule reads the preceding lines before deciding.
 */

const SKIP = [
  /\bit\.skip\b/,
  /\bdescribe\.skip\b/,
  /\btest\.skip\b/,
  /\bxit\s*\(/,
  /\bxdescribe\s*\(/,
  /\.skip\s*\(/,
  // `skipif` takes a condition; `skip` does not.
  /pytest\.mark\.skip(?!if)/,
  /@Ignore\b/,
  /\bt\.Skip(?:Now)?\s*\(/,
  /\.only\s*\(/,
];

/** An `if`, a ternary or a short-circuit — anything making the skip conditional. */
const GUARD = /\b(?:if|when|unless)\b|\?\s*$|&&\s*$/;

export const DisabledTestsRule: DeterministicRule = {
  id: 'disabled-tests',
  title: 'Tests disabled or skipped',
  defaultSeverity: 'medium',

  async run(ctx: RuleContext): Promise<DeterministicFinding[]> {
    const findings: DeterministicFinding[] = [];
    // Context lines are in the patch, so the two lines above an added skip are
    // visible whether or not they were themselves changed.
    const lines = [...iteratePatchLines(ctx.patch)];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.kind !== 'add' || !isSourcePath(line.path)) continue;
      if (!SKIP.some((p) => p.test(line.text))) continue;

      const guarded =
        GUARD.test(line.text) ||
        [1, 2].some((back) => {
          const prev = lines[i - back];
          return prev !== undefined && prev.path === line.path && GUARD.test(prev.text);
        });
      if (guarded) continue;

      findings.push({
        ruleId: 'disabled-tests',
        title: 'Tests disabled or skipped',
        severity: 'medium',
        confidence: 0.9,
        file: line.path || 'diff',
        line: line.newLine,
        message: 'A test was skipped or disabled unconditionally in the diff.',
        excerpt: line.text.trim().slice(0, 120),
        remediation: 'Restore or fix the test rather than skipping it.',
      });
      if (findings.length >= 10) break;
    }

    return findings;
  },
};
