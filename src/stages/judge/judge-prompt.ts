import type { ScoutOutput } from '../scout/scout-schema.js';
import type { BuilderOutput } from '../builder/builder-schema.js';
import type { ReviewerOutput } from '../reviewer/reviewer-schema.js';
import type { PolicyConfig } from '../../config/config-schema.js';
import type { DeterministicFinding } from '../reviewer/deterministic-rules/index.js';

export function buildJudgePrompt(
  scout: ScoutOutput | undefined,
  builder: BuilderOutput | undefined,
  reviewer: ReviewerOutput | undefined,
  policy: PolicyConfig,
  deterministicFindings: DeterministicFinding[] = [],
): { system: string; user: string } {
  const system = `You are Judge, the final evidence aggregator in the Verik pipeline.
You receive structured outputs from Scout, Builder, and Reviewer.
Your job is to determine a final verdict: pass, warn, block, or inconclusive.
Be skeptical. Dismiss Reviewer findings that lack concrete evidence.
Do NOT invent issues. A "block" verdict requires credible, evidence-backed findings.
Return ONLY the structured JudgeOutput JSON.`;

  const scoutSection = scout
    ? `SCOUT: ${scout.riskLevel} risk, ${scout.changeType}, affected: ${scout.affectedAreas.join(', ')}`
    : 'SCOUT: unavailable';

  // Limitations are included so an unrunnable check is not mistaken for a
  // failing one — "no signal" and "bad signal" warrant different verdicts.
  const builderSection = builder
    ? [
        `BUILDER: ${builder.overallStatus}`,
        ...builder.evidence.map((e) => `  - ${e.summary}`),
        ...builder.limitations.map((l) => `  ! ${l}`),
      ].join('\n')
    : 'BUILDER: not run';

  const reviewerSection = reviewer
    ? `REVIEWER VERDICT: ${reviewer.recommendedVerdict}\nFINDINGS (${reviewer.findings.length}):\n` +
      reviewer.findings
        .map((f) => `  [${f.severity}] ${f.title} (confidence: ${f.confidence})\n    ${f.summary}`)
        .join('\n')
    : 'REVIEWER: unavailable';

  const policySection = `POLICY: mode=${policy.mode}, blockAtSeverity=${policy.blockAtSeverity}, minConfidence=${policy.minimumBlockingConfidence}`;

  // Rule output, not model output. Stated separately and explicitly so the
  // Judge does not treat these as another opinion it may dismiss.
  const deterministicSection = deterministicFindings.length
    ? `DETERMINISTIC RULE FINDINGS (produced by code, not a model — treat as fact):\n` +
      deterministicFindings
        .map(
          (f) =>
            `- [${f.severity}] ${f.ruleId}: ${f.title}` +
            (f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''),
        )
        .join('\n')
    : 'DETERMINISTIC RULE FINDINGS: none fired.';

  const user = `${scoutSection}\n\n${builderSection}\n\n${deterministicSection}\n\n${reviewerSection}\n\n${policySection}\n\nReturn your JudgeOutput verdict.`;

  return { system, user };
}
