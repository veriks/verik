import type { RunContext } from '../../core/run/run-context.js';
import type { ScoutOutput } from '../scout/scout-schema.js';
import type { BuilderOutput } from '../builder/builder-schema.js';
import type { DeterministicFinding } from './deterministic-rules/index.js';
import type { StoredFinding } from '../../core/memory/memory-schema.js';

export function buildReviewerPrompt(
  context: RunContext,
  scout: ScoutOutput | undefined,
  builder: BuilderOutput | undefined,
  deterministicFindings: DeterministicFinding[],
  historicalFindings: StoredFinding[],
): { system: string; user: string } {
  const { diff, config, selectedContext } = context;

  const system = `You are Reviewer, the deep analysis stage of the Crosscheck verification pipeline.
Analyze the code change for correctness, security, data integrity, and reliability issues.
Every finding MUST cite specific file paths and line evidence from the diff or file contents provided.
Do not invent requirements. Do not repeat what linters or the deterministic rules already caught without adding analysis.
Be skeptical but fair. Return ONLY the structured ReviewerOutput JSON.`;

  const scoutSection = scout
    ? `SCOUT ANALYSIS:
  Risk: ${scout.riskLevel}
  Type: ${scout.changeType}
  Affected areas: ${scout.affectedAreas.join(', ')}
  Review focus: ${scout.reviewFocus.join(', ')}`
    : 'SCOUT: not available';

  const builderSection = builder
    ? `BUILDER RESULTS (deterministic):
  Status: ${builder.overallStatus}
  ${builder.commands.map((c) => `  ${c.status === 'passed' ? '✓' : '✗'} ${c.command} (${c.durationMs}ms)`).join('\n  ')}
  ${builder.evidence.length ? 'Evidence:\n  ' + builder.evidence.map((e) => e.summary).join('\n  ') : ''}`
    : 'BUILDER: not run';

  const deterministicSection = deterministicFindings.length > 0
    ? `DETERMINISTIC RULE FINDINGS (already detected — do not re-report, but you may add analysis):\n` +
      deterministicFindings.map((f) => `  [${f.severity.toUpperCase()}] ${f.title}: ${f.message}`).join('\n')
    : 'DETERMINISTIC RULES: no findings';

  // Historical findings from memory — most relevant when the same file has failed review before
  const memorySection = historicalFindings.length > 0
    ? `HISTORICAL FINDINGS FOR CHANGED FILES (from previous runs on this repository):\n` +
      historicalFindings.slice(0, 10).map((f) =>
        `  [${f.severity.toUpperCase()}] ${f.title} — ${f.judgeDisposed} in run ${f.runId.slice(0, 12)} (confidence was ${(f.confidence * 100).toFixed(0)}%)`
      ).join('\n') +
      '\nThese are prior findings on the same files. Consider whether this change addresses, repeats, or worsens them.'
    : '';

  // Use selected context if available; fall back to raw diff
  const patch = selectedContext?.diff ?? diff?.patch ?? '(no diff)';
  const maxBytes = config.verification.maxDiffBytes;
  const patchSection = patch.length > maxBytes
    ? patch.slice(0, maxBytes) + '\n... [truncated]'
    : patch;

  const fileContents = selectedContext?.changedFiles.length
    ? '\n\nCHANGED FILE CONTENTS:\n' + selectedContext.changedFiles
        .map((f) => `--- ${f.path} (lines ${f.startLine}-${f.endLine}${f.truncated ? ', truncated' : ''}) ---\n${f.content}`)
        .join('\n\n')
    : '';

  const limitations = selectedContext?.limitations.length
    ? `\nCONTEXT LIMITATIONS: ${selectedContext.limitations.join('; ')}`
    : '';

  const user = `${scoutSection}

${builderSection}

${deterministicSection}
${memorySection ? '\n' + memorySection : ''}

DIFF:${limitations}
${patchSection}${fileContents}

Analyze this change and return structured ReviewerOutput.`;

  return { system, user };
}
