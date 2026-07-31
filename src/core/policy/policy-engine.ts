import type { JudgeOutput } from '../../stages/judge/judge-schema.js';
import type { PolicyConfig } from '../../config/config-schema.js';
import type { PolicyResult } from './policy-schema.js';

const SEVERITY_ORDER = ['info', 'low', 'medium', 'high', 'critical'] as const;

function severityIndex(s: string): number {
  return SEVERITY_ORDER.indexOf(s as (typeof SEVERITY_ORDER)[number]);
}

export function evaluatePolicy(judge: JudgeOutput, policy: PolicyConfig): PolicyResult {
  const mode = policy.mode;

  if (mode === 'shadow') {
    return {
      mode,
      decision: 'allow',
      exitCode: 0,
      reason: 'Shadow mode: always allow.',
      overrideAvailable: policy.allowOverride,
    };
  }

  const verdict = judge.verdict;

  if (verdict === 'pass') {
    return {
      mode,
      decision: 'allow',
      exitCode: 0,
      reason: 'Judge verdict: pass.',
      overrideAvailable: policy.allowOverride,
    };
  }

  if (verdict === 'inconclusive') {
    const exitCode = mode === 'blocking' ? 3 : 0;
    return {
      mode,
      decision: mode === 'blocking' ? 'warn' : 'allow',
      exitCode,
      reason: 'Verification inconclusive.',
      overrideAvailable: policy.allowOverride,
    };
  }

  if (verdict === 'block') {
    const blockingReason = judge.reasons[0];
    const reasonSeverity = blockingReason?.severity ?? 'high';
    const meetsThreshold =
      judge.confidence >= policy.minimumBlockingConfidence &&
      severityIndex(reasonSeverity) >= severityIndex(policy.blockAtSeverity);

    if (mode === 'blocking' && meetsThreshold) {
      return {
        mode,
        decision: 'deny',
        exitCode: 2,
        reason: judge.summary,
        overrideAvailable: policy.allowOverride,
      };
    }

    return {
      mode,
      decision: 'warn',
      exitCode: 0,
      reason: judge.summary,
      overrideAvailable: policy.allowOverride,
    };
  }

  // warn verdict
  return {
    mode,
    decision: 'warn',
    exitCode: 0,
    reason: judge.summary,
    overrideAvailable: policy.allowOverride,
  };
}
