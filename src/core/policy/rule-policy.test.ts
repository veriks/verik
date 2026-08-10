import { describe, it, expect } from 'vitest';
import { applyRulePolicy } from './rule-policy.js';
import { PolicyConfigSchema } from '../../config/config-schema.js';
import type { DeterministicFinding } from '../../stages/reviewer/deterministic-rules/index.js';

const finding = (ruleId: string, severity: DeterministicFinding['severity']) =>
  ({
    ruleId,
    title: `${ruleId} fired`,
    severity,
    confidence: 0.9,
    file: 'src/a.ts',
    line: 1,
    message: '',
    excerpt: '',
    remediation: '',
  }) satisfies DeterministicFinding;

const rules = (input: unknown) =>
  PolicyConfigSchema.parse({ version: 1, rules: input as never }).rules;

describe('applyRulePolicy', () => {
  it('leaves findings untouched when no policy is set', () => {
    const found = [finding('secret-leak', 'critical')];
    const { kept, suppressed } = applyRulePolicy(found, undefined);
    expect(kept).toEqual(found);
    expect(suppressed).toHaveLength(0);
  });

  it('remaps severity while keeping the finding in the report', () => {
    // The point of the severity lever: the information survives, it just stops
    // crossing the blocking threshold.
    const { kept } = applyRulePolicy(
      [finding('debug-artifact', 'low')],
      rules({ severity: { 'debug-artifact': 'info' } }),
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.severity).toBe('info');
    expect(kept[0]!.title).toBe('debug-artifact fired');
  });

  it('can raise a severity as well as lower it', () => {
    const { kept } = applyRulePolicy(
      [finding('lockfile-changed', 'info')],
      rules({ severity: { 'lockfile-changed': 'high' } }),
    );
    expect(kept[0]!.severity).toBe('high');
  });

  it('suppresses a disabled rule rather than dropping it', () => {
    // A disabled rule must never hide something silently — the finding leaves
    // the blocking path but stays on the record.
    const { kept, suppressed } = applyRulePolicy(
      [finding('type-escape', 'low'), finding('secret-leak', 'critical')],
      rules({ disabled: [{ id: 'type-escape', reason: 'generated bindings' }] }),
    );
    expect(kept.map((f) => f.ruleId)).toEqual(['secret-leak']);
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]!.reason).toBe('generated bindings');
    expect(suppressed[0]!.source).toBe('policy');
    expect(suppressed[0]!.title).toBe('type-escape fired');
  });

  it('only touches the rule named', () => {
    const { kept } = applyRulePolicy(
      [finding('a', 'high'), finding('b', 'high')],
      rules({ severity: { a: 'info' }, disabled: [] }),
    );
    expect(kept.find((f) => f.ruleId === 'b')!.severity).toBe('high');
  });

  it('disabling wins over a severity remap for the same rule', () => {
    const { kept, suppressed } = applyRulePolicy(
      [finding('x', 'high')],
      rules({ severity: { x: 'info' }, disabled: [{ id: 'x', reason: 'n/a here' }] }),
    );
    expect(kept).toHaveLength(0);
    expect(suppressed).toHaveLength(1);
  });
});

describe('policy schema', () => {
  it('defaults to no rule tuning at all', () => {
    const policy = PolicyConfigSchema.parse({ version: 1 });
    expect(policy.rules.disabled).toEqual([]);
    expect(policy.rules.severity).toEqual({});
  });

  it('refuses to disable a rule without a reason', () => {
    // A check switched off with no explanation is exactly what this tool exists
    // to surface, so the schema will not store one.
    const result = PolicyConfigSchema.safeParse({
      version: 1,
      rules: { disabled: [{ id: 'secret-leak' }] },
    });
    expect(result.success).toBe(false);
  });

  it('refuses an empty reason too', () => {
    const result = PolicyConfigSchema.safeParse({
      version: 1,
      rules: { disabled: [{ id: 'secret-leak', reason: '' }] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a severity that is not a real level', () => {
    const result = PolicyConfigSchema.safeParse({
      version: 1,
      rules: { severity: { 'debug-artifact': 'whenever' } },
    });
    expect(result.success).toBe(false);
  });

  it('reads a policy written before per-rule tuning existed', () => {
    // Existing repositories have a policy.json with no `rules` key.
    const policy = PolicyConfigSchema.parse({
      version: 1,
      mode: 'blocking',
      blockAtSeverity: 'high',
      minimumBlockingConfidence: 0.8,
      requireBuilderSuccess: false,
      allowOverride: true,
    });
    expect(policy.rules.disabled).toEqual([]);
  });
});
