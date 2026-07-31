import type { RunContext } from '../../core/run/run-context.js';
import type { ScoutOutput } from '../scout/scout-schema.js';
import type { BuilderOutput } from '../builder/builder-schema.js';
import type { DeterministicFinding } from './deterministic-rules/index.js';
import { truncateBytes } from '../../shared/tokens.js';

export function buildReviewerPrompt(
  context: RunContext,
  scout: ScoutOutput | undefined,
  builder: BuilderOutput | undefined,
  deterministicFindings: DeterministicFinding[],
): { system: string; user: string } {
  const { diff, config } = context;

  const system = `You are Reviewer, the deep analysis stage of the Crosscheck verification pipeline.
Analyze the code change for correctness, security, data integrity, and reliability issues.
Every finding MUST cite specific file paths and line evidence from the diff.
Do not invent requirements. Do not repeat what linters already caught.
Be skeptical but fair. Return ONLY the structured ReviewerOutput JSON.`;

  const scoutSection = scout
    ? `SCOUT ANALYSIS:\n  Risk: ${scout.riskLevel}\n  Type: ${scout.changeType}\n  Focus: ${scout.reviewFocus.join(', ')}`
    : 'SCOUT: not available';

  const builderSection = builder
    ? `BUILDER RESULTS:\n  Status: ${builder.overallStatus}\n  ${builder.evidence.map((e) => e.summary).join('\n  ')}`
    : 'BUILDER: not run';

  const deterministicSection =
    deterministicFindings.length > 0
      ? `DETERMINISTIC FINDINGS:\n` + deterministicFindings.map((f) => `  [${f.severity}] ${f.title}: ${f.message}`).join('\n')
      : 'DETERMINISTIC: no findings';

  const patchSection = diff?.patch
    ? truncateBytes(diff.patch, Math.min(config.verification.maxDiffBytes, 60_000))
    : '(no diff)';

  const user = `${scoutSection}\n\n${builderSection}\n\n${deterministicSection}\n\nDIFF:\n${patchSection}\n\nAnalyze this change and return structured ReviewerOutput.`;

  return { system, user };
}
