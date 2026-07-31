import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from './policy-engine.js';
import type { JudgeOutput } from '../../stages/judge/judge-schema.js';
import { DEFAULT_POLICY } from '../../config/defaults.js';

const baseJudge: JudgeOutput = {
  verdict: 'pass',
  confidence: 0.9,
  summary: 'All good',
  reasons: [],
  dismissedFindings: [],
  requiredActions: [],
  limitations: [],
};

describe('evaluatePolicy', () => {
  it('allows pass verdict', () => {
    const result = evaluatePolicy(baseJudge, DEFAULT_POLICY);
    expect(result.decision).toBe('allow');
    expect(result.exitCode).toBe(0);
  });

  it('shadow mode always allows', () => {
    const policy = { ...DEFAULT_POLICY, mode: 'shadow' as const };
    const result = evaluatePolicy({ ...baseJudge, verdict: 'block' }, policy);
    expect(result.decision).toBe('allow');
    expect(result.exitCode).toBe(0);
  });

  it('advisory mode warns but does not block', () => {
    const policy = { ...DEFAULT_POLICY, mode: 'advisory' as const };
    const judge: JudgeOutput = {
      ...baseJudge,
      verdict: 'block',
      reasons: [{ title: 'Issue', severity: 'high', findingIds: [], builderEvidenceRefs: [] }],
    };
    const result = evaluatePolicy(judge, policy);
    expect(result.decision).toBe('warn');
    expect(result.exitCode).toBe(0);
  });

  it('blocking mode denies on high severity with sufficient confidence', () => {
    const policy = { ...DEFAULT_POLICY, mode: 'blocking' as const };
    const judge: JudgeOutput = {
      ...baseJudge,
      verdict: 'block',
      confidence: 0.9,
      reasons: [{ title: 'Issue', severity: 'high', findingIds: [], builderEvidenceRefs: [] }],
    };
    const result = evaluatePolicy(judge, policy);
    expect(result.decision).toBe('deny');
    expect(result.exitCode).toBe(2);
  });

  it('blocking mode does not block below confidence threshold', () => {
    const policy = { ...DEFAULT_POLICY, mode: 'blocking' as const, minimumBlockingConfidence: 0.95 };
    const judge: JudgeOutput = {
      ...baseJudge,
      verdict: 'block',
      confidence: 0.5,
      reasons: [{ title: 'Issue', severity: 'high', findingIds: [], builderEvidenceRefs: [] }],
    };
    const result = evaluatePolicy(judge, policy);
    expect(result.decision).toBe('warn');
  });
});
