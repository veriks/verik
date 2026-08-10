import type { RulePolicy } from '../../config/config-schema.js';
import type { DeterministicFinding } from '../../stages/reviewer/deterministic-rules/index.js';
import type { SuppressedFinding } from './override-engine.js';
import { logger } from '../../shared/logger.js';

/**
 * Applying per-rule policy to deterministic findings.
 *
 * Two levers, deliberately different in strength:
 *
 *  - `severity` remaps a rule's findings. The finding stays in the report and
 *    the Judge still sees it; it just stops crossing the blocking threshold.
 *    This is the one to reach for, because the information survives.
 *  - `disabled` suppresses. The rule still *runs* — at twenty-odd local regex
 *    passes that costs nothing — and what it found is recorded as suppressed
 *    rather than dropped. A disabled rule can therefore never hide something
 *    silently, which is the whole reason to prefer suppression over skipping.
 */
export function applyRulePolicy(
  findings: DeterministicFinding[],
  rules: RulePolicy | undefined,
): { kept: DeterministicFinding[]; suppressed: SuppressedFinding[] } {
  if (!rules) return { kept: findings, suppressed: [] };

  const disabled = new Map(rules.disabled.map((d) => [d.id, d.reason]));
  const kept: DeterministicFinding[] = [];
  const suppressed: SuppressedFinding[] = [];

  for (const finding of findings) {
    const reason = disabled.get(finding.ruleId);
    if (reason !== undefined) {
      logger.debug(`Policy disabled rule ${finding.ruleId}: ${finding.title}`);
      suppressed.push({
        type: 'deterministic',
        title: finding.title,
        overrideId: `policy:${finding.ruleId}`,
        reason,
        source: 'policy',
      });
      continue;
    }

    const remapped = rules.severity[finding.ruleId];
    kept.push(remapped ? { ...finding, severity: remapped } : finding);
  }

  return { kept, suppressed };
}
