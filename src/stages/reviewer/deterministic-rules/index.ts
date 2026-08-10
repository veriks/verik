import type { DiffResult } from '../../../core/repository/diff-capture.js';
import type { RawPatch } from '../../../core/privacy/patch-types.js';
import type { Severity } from '../../../shared/schemas.js';

export interface DeterministicFinding {
  ruleId: string;
  title: string;
  severity: Severity;
  confidence: number;
  file: string;
  line?: number;
  message: string;
  excerpt: string;
  remediation: string;
}

export interface RuleContext {
  diff: DiffResult;
  /**
   * Deliberately the *unredacted* patch. These rules run locally and never call
   * out, and SecretLeakRule cannot detect a secret that has already been
   * replaced with `[REDACTED]` — feeding it the sanitised patch would silently
   * disable the very rule most worth having.
   */
  patch: RawPatch;
}

export interface DeterministicRule {
  id: string;
  title: string;
  run(context: RuleContext): Promise<DeterministicFinding[]>;
}

export async function runDeterministicRules(context: RuleContext): Promise<DeterministicFinding[]> {
  const { SecretLeakRule } = await import('./secret-leak.js');
  const { EnvFileRule } = await import('./env-file.js');
  const { EvalUsageRule } = await import('./eval-usage.js');
  const { DisabledTestsRule } = await import('./disabled-tests.js');
  const { EmptyCatchRule } = await import('./empty-catch.js');
  const { DbMigrationRule } = await import('./db-migration.js');
  const { LockfileChangedRule } = await import('./lockfile-changed.js');

  const rules: DeterministicRule[] = [
    new SecretLeakRule(),
    new EnvFileRule(),
    new EvalUsageRule(),
    new DisabledTestsRule(),
    new EmptyCatchRule(),
    new DbMigrationRule(),
    new LockfileChangedRule(),
  ];

  const allFindings: DeterministicFinding[] = [];
  for (const rule of rules) {
    try {
      const findings = await rule.run(context);
      allFindings.push(...findings);
    } catch {
      // rules must not crash the pipeline
    }
  }
  return allFindings;
}
