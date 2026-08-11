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
  /**
   * Severity this rule's findings carry before any policy remapping. Declared
   * rather than derived so `verik rules` can list the catalogue without
   * running a single rule against a diff.
   */
  defaultSeverity?: Severity;
  run(context: RuleContext): Promise<DeterministicFinding[]>;
}

export interface RuleSummary {
  id: string;
  title: string;
  severity: Severity;
}

/** The catalogue, for listing and validating rule IDs. */
export async function listRules(): Promise<RuleSummary[]> {
  const rules = await loadRules();
  return rules.map((r) => ({ id: r.id, title: r.title, severity: r.defaultSeverity ?? 'medium' }));
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * Ceiling on deterministic findings from a single run.
 *
 * Individual rules cap themselves, but twenty rules each contributing their
 * maximum would still produce a report nobody reads — and an unreadable report
 * is indistinguishable from no report. Findings are ordered by severity before
 * the cut, so what survives truncation is the part worth acting on.
 */
const MAX_TOTAL_FINDINGS = 40;

export async function loadRules(): Promise<DeterministicRule[]> {
  const [secret, env, evalUse, disabled, emptyCatch, migration, lockfile, shortcuts, sec, repo] =
    await Promise.all([
      import('./secret-leak.js'),
      import('./env-file.js'),
      import('./eval-usage.js'),
      import('./disabled-tests.js'),
      import('./empty-catch.js'),
      import('./db-migration.js'),
      import('./lockfile-changed.js'),
      import('./agent-shortcuts.js'),
      import('./security-patterns.js'),
      import('./repo-integrity.js'),
    ]);

  return [
    // Leaked credentials first: the only finding class that stays dangerous
    // after the change is reverted.
    secret.SecretLeakRule,
    env.EnvFileRule,

    // Unsafe shortcuts.
    sec.InsecureTransportRule,
    sec.WeakCryptoRule,
    sec.SqlInjectionRule,
    sec.CommandInjectionRule,
    sec.PermissiveAccessRule,
    evalUse.EvalUsageRule,

    // Work reported as done that is not done.
    shortcuts.StubImplementationRule,
    shortcuts.SuppressionAddedRule,
    shortcuts.SwallowedErrorRule,
    emptyCatch.EmptyCatchRule,
    shortcuts.TypeEscapeRule,
    shortcuts.DebugArtifactRule,

    // Changes to the machinery that decides whether the change passes.
    repo.TestRemovalRule,
    repo.TautologicalAssertionRule,
    disabled.DisabledTestsRule,
    repo.AuthCheckRemovedRule,
    repo.CiWorkflowModifiedRule,
    repo.GitignoreWeakenedRule,
    repo.RiskyDependencySourceRule,

    // Context worth surfacing, not problems in themselves.
    migration.DbMigrationRule,
    lockfile.LockfileChangedRule,
  ];
}

export async function runDeterministicRules(context: RuleContext): Promise<DeterministicFinding[]> {
  const rules = await loadRules();

  // Rules are independent and none of them touch the network or the disk, so
  // a failure in one must not lose the results of the others.
  const results = await Promise.all(
    rules.map(async (rule) => {
      try {
        return await rule.run(context);
      } catch {
        // A rule must never crash the pipeline. Its findings are lost; every
        // other rule's are not.
        return [];
      }
    }),
  );

  return results
    .flat()
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, MAX_TOTAL_FINDINGS);
}
