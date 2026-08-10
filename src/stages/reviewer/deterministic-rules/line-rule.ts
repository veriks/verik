import type { Severity } from '../../../shared/schemas.js';
import type { DeterministicFinding, DeterministicRule, RuleContext } from './index.js';
import { iterateAddedLines, iterateRemovedLines } from './patch-lines.js';
import { isSourcePath } from './file-kinds.js';

/**
 * Most rules are the same shape: walk one side of the diff, match some patterns
 * against each line, emit a finding. Writing that loop by hand once per rule is
 * how the `/g` bug happened — a global regex driven by `.test()` carries
 * `lastIndex` between calls and silently matches every *second* occurrence.
 * Declaring rules instead of implementing them means that loop exists once.
 */
export interface LineRuleSpec {
  id: string;
  title: string;
  severity: Severity;
  confidence: number;
  message: string;
  remediation: string;
  /** Any match makes the line a finding. */
  patterns: RegExp[];
  /** Checked first; a match here suppresses the line entirely. */
  exceptions?: RegExp[];
  /** Defaults to hand-written source, tests included. */
  appliesTo?: (path: string) => boolean;
  /** Which side of the diff to read. Defaults to added lines. */
  side?: 'added' | 'removed';
  /**
   * Skip comment lines. Defaults to true: prose describing a hazard is not the
   * hazard. Rules whose entire subject *is* a comment — a suppression pragma, a
   * TODO marker — must opt out.
   */
  skipComments?: boolean;
  /**
   * Ceiling on findings from one rule in one run. An agent that adds three
   * hundred `console.log` calls has one problem, not three hundred findings,
   * and a report nobody can read is a report nobody reads.
   */
  maxFindings?: number;
}

/**
 * A global regex is a bug in this position, not a style preference, so it is
 * rejected at construction rather than left to misbehave at runtime.
 */
function assertNotGlobal(id: string, patterns: RegExp[]): void {
  for (const p of patterns) {
    if (p.global || p.sticky) {
      throw new Error(
        `Rule "${id}" declares /${p.source}/${p.flags} — the g and y flags make ` +
          '.test() stateful and cause every second match to be missed. Remove them.',
      );
    }
  }
}

/**
 * A line consisting of nothing but a regex or string literal, optionally with a
 * trailing comma — an entry in a pattern table or a test fixture.
 *
 * This matters far beyond this codebase. Any security scanner, linter config,
 * WAF ruleset or parser test suite contains lines that are literally the thing
 * being detected, and flagging them turns every such project's own source into
 * a wall of findings. The data is not the behaviour.
 */
const LITERAL_ONLY =
  /^\s*(?:\/(?:[^/\\\n]|\\.)+\/[gimsuydv]*|(['"`])(?:(?!\1)[^\\]|\\.)*\1)\s*,?\s*$/;

/**
 * Line comment openers across the languages these rules cover.
 *
 * The block-comment continuation form requires whitespace after the asterisk:
 * a JSDoc line is `* text`, whereas `*.pem` is a gitignore glob, and treating
 * the latter as a comment silently disabled the ignore-file rule.
 */
const COMMENT_ONLY = /^\s*(?:\/\/|\/\*|\*\s|#|--\s|<!--|;;)/;

export function defineLineRule(spec: LineRuleSpec): DeterministicRule {
  assertNotGlobal(spec.id, spec.patterns);
  if (spec.exceptions) assertNotGlobal(spec.id, spec.exceptions);

  const applies = spec.appliesTo ?? isSourcePath;
  const limit = spec.maxFindings ?? 10;
  const walk = spec.side === 'removed' ? iterateRemovedLines : iterateAddedLines;
  const skipComments = spec.skipComments ?? true;

  return {
    id: spec.id,
    title: spec.title,
    defaultSeverity: spec.severity,
    async run(ctx: RuleContext): Promise<DeterministicFinding[]> {
      const findings: DeterministicFinding[] = [];
      const seen = new Set<string>();

      for (const line of walk(ctx.patch)) {
        if (findings.length >= limit) break;
        if (!applies(line.path)) continue;
        if (LITERAL_ONLY.test(line.text)) continue;
        if (skipComments && COMMENT_ONLY.test(line.text)) continue;
        if (spec.exceptions?.some((r) => r.test(line.text))) continue;
        if (!spec.patterns.some((r) => r.test(line.text))) continue;

        // A moved block can present the same file:line twice across hunks.
        const key = `${line.path}:${line.line}`;
        if (seen.has(key)) continue;
        seen.add(key);

        findings.push({
          ruleId: spec.id,
          title: spec.title,
          severity: spec.severity,
          confidence: spec.confidence,
          file: line.path || 'diff',
          line: line.line,
          message: spec.message,
          excerpt: line.text.trim().slice(0, 120),
          remediation: spec.remediation,
        });
      }
      return findings;
    },
  };
}
