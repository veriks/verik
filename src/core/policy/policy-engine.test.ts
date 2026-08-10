import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from './policy-engine.js';
import type { JudgeOutput } from '../../stages/judge/judge-schema.js';
import { DEFAULT_POLICY } from '../../config/defaults.js';
import type { DeterministicFinding } from '../../stages/reviewer/deterministic-rules/index.js';

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
    const result = evaluatePolicy({ judge: baseJudge, policy: DEFAULT_POLICY });
    expect(result.decision).toBe('allow');
    expect(result.exitCode).toBe(0);
  });

  it('shadow mode always allows', () => {
    const policy = { ...DEFAULT_POLICY, mode: 'shadow' as const };
    const result = evaluatePolicy({ judge: { ...baseJudge, verdict: 'block' }, policy: policy });
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
    const result = evaluatePolicy({ judge, policy });
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
    const result = evaluatePolicy({ judge, policy });
    expect(result.decision).toBe('deny');
    expect(result.exitCode).toBe(2);
  });

  it('blocking mode does not block below confidence threshold', () => {
    const policy = {
      ...DEFAULT_POLICY,
      mode: 'blocking' as const,
      minimumBlockingConfidence: 0.95,
    };
    const judge: JudgeOutput = {
      ...baseJudge,
      verdict: 'block',
      confidence: 0.5,
      reasons: [{ title: 'Issue', severity: 'high', findingIds: [], builderEvidenceRefs: [] }],
    };
    const result = evaluatePolicy({ judge, policy });
    expect(result.decision).toBe('warn');
  });
});

/**
 * Deterministic findings are facts about the diff, not probabilistic claims, so
 * they bypass the Judge's confidence gate and cannot be dismissed by a model.
 * Before this, evaluatePolicy only ever saw the Judge verdict — a critical
 * secret-leak finding could not block anything, and in rules mode there was no
 * policy evaluation at all.
 */
const secretLeak: DeterministicFinding = {
  ruleId: 'secret-leak',
  title: 'Likely secret added to diff',
  severity: 'critical',
  confidence: 0.85,
  file: 'src/app.ts',
  line: 1,
  message: 'An API key pattern was found in an added line.',
  excerpt: '+const KEY = "sk-..."',
  remediation: 'Remove the credential and rotate it.',
};

const blocking = { ...DEFAULT_POLICY, mode: 'blocking' as const };

describe('evaluatePolicy — deterministic findings', () => {
  it('blocks on a critical rule finding with no Judge at all', () => {
    // Rules mode: this is the exact case that used to exit 0.
    const r = evaluatePolicy({ deterministicFindings: [secretLeak], policy: blocking });
    expect(r.decision).toBe('deny');
    expect(r.exitCode).toBe(2);
    expect(r.reason).toContain('secret-leak');
  });

  it('blocks even when the Judge said pass', () => {
    // Deterministic evidence outranks model opinion — the invariant this
    // function exists to enforce.
    const r = evaluatePolicy({
      judge: baseJudge,
      deterministicFindings: [secretLeak],
      policy: blocking,
    });
    expect(r.decision).toBe('deny');
  });

  it('ignores the Judge confidence threshold for rule findings', () => {
    // A rule matched; there is no probability to be under-confident about.
    const r = evaluatePolicy({
      judge: { ...baseJudge, confidence: 0.01 },
      deterministicFindings: [secretLeak],
      policy: { ...blocking, minimumBlockingConfidence: 0.99 },
    });
    expect(r.exitCode).toBe(2);
  });

  it('warns rather than denies in advisory mode', () => {
    const r = evaluatePolicy({ deterministicFindings: [secretLeak], policy: DEFAULT_POLICY });
    expect(r.decision).toBe('warn');
    expect(r.exitCode).toBe(0);
  });

  it('never blocks in shadow mode', () => {
    const r = evaluatePolicy({
      deterministicFindings: [secretLeak],
      policy: { ...DEFAULT_POLICY, mode: 'shadow' },
    });
    expect(r.exitCode).toBe(0);
  });

  it('does not block on findings below the severity threshold', () => {
    const r = evaluatePolicy({
      deterministicFindings: [{ ...secretLeak, severity: 'low' }],
      policy: blocking,
    });
    expect(r.decision).toBe('allow');
    expect(r.exitCode).toBe(0);
  });

  it('allows a clean rules-only run', () => {
    const r = evaluatePolicy({ deterministicFindings: [], policy: blocking });
    expect(r.decision).toBe('allow');
    expect(r.reason).toContain('No rule findings');
  });

  it('reports the worst finding and counts the rest', () => {
    const r = evaluatePolicy({
      deterministicFindings: [{ ...secretLeak, severity: 'high' }, secretLeak],
      policy: blocking,
    });
    expect(r.reason).toContain('critical' === secretLeak.severity ? 'secret-leak' : '');
    expect(r.reason).toContain('1 other');
  });
});
