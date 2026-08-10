import type { JudgeOutput } from '../../stages/judge/judge-schema.js';
import type { PolicyConfig } from '../../config/config-schema.js';
import type { PolicyResult } from './policy-schema.js';
import type { DeterministicFinding } from '../../stages/reviewer/deterministic-rules/index.js';

const SEVERITY_ORDER = ['info', 'low', 'medium', 'high', 'critical'] as const;

function severityIndex(s: string): number {
  return SEVERITY_ORDER.indexOf(s as (typeof SEVERITY_ORDER)[number]);
}

export interface PolicyInput {
  /** Absent in rules mode, or when the Judge stage failed. */
  judge?: JudgeOutput;
  /** Rule output. Facts, not opinion — see below. */
  deterministicFindings?: DeterministicFinding[];
  policy: PolicyConfig;
}

/**
 * Turns evidence into a ship / do-not-ship decision.
 *
 * Deterministic findings are evaluated *before and independently of* the Judge.
 * A rule firing is a fact about the diff — a secret is present, a migration was
 * added — not a probabilistic claim, so it is not subject to the Judge's
 * confidence threshold and cannot be dismissed by a model. This is what the
 * "deterministic evidence outranks model opinion" invariant actually means; it
 * was previously unenforceable, because the policy engine only ever saw the
 * Judge verdict and a critical secret-leak finding could not block anything.
 */
export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const { judge, deterministicFindings = [], policy } = input;
  const mode = policy.mode;
  const overrideAvailable = policy.allowOverride;

  // Shadow mode's contract is that it never affects the outcome. It records.
  if (mode === 'shadow') {
    return {
      mode,
      decision: 'allow',
      exitCode: 0,
      reason: 'Shadow mode: always allow.',
      overrideAvailable,
    };
  }

  const blockingRules = deterministicFindings.filter(
    (f) => severityIndex(f.severity) >= severityIndex(policy.blockAtSeverity),
  );

  if (blockingRules.length > 0) {
    const worst = [...blockingRules].sort(
      (a, b) => severityIndex(b.severity) - severityIndex(a.severity),
    )[0]!;
    const detail = `${worst.ruleId}: ${worst.title}${worst.file ? ` (${worst.file}${worst.line ? `:${worst.line}` : ''})` : ''}`;
    const more =
      blockingRules.length > 1 ? ` — and ${blockingRules.length - 1} other rule finding(s)` : '';

    // No confidence gate: the rule matched, so the thing it detects is present.
    return {
      mode,
      decision: mode === 'blocking' ? 'deny' : 'warn',
      exitCode: mode === 'blocking' ? 2 : 0,
      reason: `${detail}${more}`,
      overrideAvailable,
    };
  }

  // Rules mode reaches here with no Judge, and that is a complete result: the
  // deterministic checks ran and found nothing blocking.
  if (!judge) {
    return {
      mode,
      decision: 'allow',
      exitCode: 0,
      reason: deterministicFindings.length
        ? `${deterministicFindings.length} rule finding(s), none at or above ${policy.blockAtSeverity}.`
        : 'No rule findings.',
      overrideAvailable,
    };
  }

  const verdict = judge.verdict;

  if (verdict === 'pass') {
    return {
      mode,
      decision: 'allow',
      exitCode: 0,
      reason: 'Judge verdict: pass.',
      overrideAvailable,
    };
  }

  if (verdict === 'inconclusive') {
    return {
      mode,
      decision: mode === 'blocking' ? 'warn' : 'allow',
      exitCode: mode === 'blocking' ? 3 : 0,
      reason: 'Verification inconclusive.',
      overrideAvailable,
    };
  }

  if (verdict === 'block') {
    const blockingReason = judge.reasons[0];
    const reasonSeverity = blockingReason?.severity ?? 'high';
    // The Judge is a model, so its verdict *is* gated on confidence and
    // severity — the opposite of how rule findings are treated above.
    const meetsThreshold =
      judge.confidence >= policy.minimumBlockingConfidence &&
      severityIndex(reasonSeverity) >= severityIndex(policy.blockAtSeverity);

    if (mode === 'blocking' && meetsThreshold) {
      return {
        mode,
        decision: 'deny',
        exitCode: 2,
        reason: judge.summary,
        overrideAvailable,
      };
    }

    return { mode, decision: 'warn', exitCode: 0, reason: judge.summary, overrideAvailable };
  }

  // warn verdict
  return { mode, decision: 'warn', exitCode: 0, reason: judge.summary, overrideAvailable };
}
