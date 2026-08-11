import type { RunContext } from '../run/run-context.js';
import type { PipelineResult } from '../pipeline/verification-pipeline.js';
import { redactCommandLine } from '../../shared/redaction.js';

export function renderReport(context: RunContext, pipeline: PipelineResult): string {
  const { record, diff } = context;
  const lines: string[] = [];

  lines.push(`# Verik Report`);
  lines.push(`\n**Run:** ${record.runId}`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);

  lines.push(`\n## 1. Overview`);
  lines.push(`- Command: \`${redactCommandLine(record.wrappedCommand)}\``);
  lines.push(`- Branch: ${record.branch}`);
  lines.push(`- Baseline commit: ${record.baselineCommitSha}`);
  if (context.intent) lines.push(`- Intent: ${context.intent}`);

  lines.push(`\n## 2. Attributable Diff`);
  lines.push(`> Changes introduced **by this command**, excluding pre-existing work.`);
  lines.push(`- Command-introduced files: ${diff?.commandIntroducedPaths.length ?? 0}`);
  lines.push(`- Pre-existing changed files: ${diff?.preExistingChangedPaths.length ?? 0}`);
  lines.push(`- Total: +${diff?.additions ?? 0} / -${diff?.deletions ?? 0}`);
  if (diff?.truncated) lines.push(`> **Note:** Diff was truncated due to size.`);

  if (diff?.commandIntroducedPaths.length) {
    lines.push(`\n### Introduced by this command`);
    for (const p of diff.commandIntroducedPaths) lines.push(`- \`${p}\``);
  }
  if (diff?.preExistingChangedPaths.length) {
    // These sets legitimately overlap: tree-based attribution can credit the
    // command's hunk in a file that was already dirty. Marking the overlap is
    // clearer than the old "not attributed" heading, which is now only true of
    // the files that appear here alone.
    const introduced = new Set(diff.commandIntroducedPaths);
    lines.push(`\n### Already modified before this command ran`);
    for (const p of diff.preExistingChangedPaths) {
      const both = introduced.has(p);
      lines.push(`- \`${p}\`${both ? ' — also edited by this command (its hunks are above)' : ''}`);
    }
  }

  lines.push(`\n## 3. Stage Results`);
  for (const [stage, status] of Object.entries(pipeline.stageStatuses)) {
    lines.push(`- **${stage}**: ${status ?? 'unknown'}`);
  }

  if (pipeline.scout) {
    const s = pipeline.scout;
    lines.push(`\n## 4. Scout Analysis (AI)`);
    lines.push(`- **Risk:** ${s.riskLevel.toUpperCase()}`);
    lines.push(`- **Type:** ${s.changeType}`);
    lines.push(`- **Summary:** ${s.changeSummary}`);
    if (s.affectedAreas.length) lines.push(`- **Affected:** ${s.affectedAreas.join(', ')}`);
    if (s.reviewFocus.length) lines.push(`- **Review focus:** ${s.reviewFocus.join(', ')}`);
    if (s.builderRecommendations.length) {
      lines.push(`\n**Verification goals** (passed to deterministic Builder planner):`);
      for (const r of s.builderRecommendations) lines.push(`- ${r}`);
    }
    if (s.uncertainties.length) {
      lines.push(`\n**Uncertainties:**`);
      for (const u of s.uncertainties) lines.push(`- ${u}`);
    }
  }

  if (pipeline.builder) {
    const b = pipeline.builder;
    lines.push(`\n## 5. Builder Evidence (deterministic)`);
    lines.push(`> Builder runs allowlisted commands only. No LLM involvement.`);
    lines.push(`- **Status:** ${b.overallStatus.toUpperCase()}`);
    if (b.packageManager) lines.push(`- **Package manager:** ${b.packageManager}`);
    for (const cmd of b.commands) {
      const icon = cmd.status === 'passed' ? '✓' : cmd.status === 'failed' ? '✗' : '~';
      lines.push(`- ${icon} \`${cmd.command}\` → ${cmd.status} (${cmd.durationMs}ms)`);
      if ((cmd.status === 'failed' || cmd.status === 'errored') && cmd.stderrTail) {
        lines.push(`\n  \`\`\`\n  ${cmd.stderrTail.slice(0, 400)}\n  \`\`\``);
      }
    }
    if (b.limitations.length) lines.push(`\n**Limitations:** ${b.limitations.join('; ')}`);
  }

  if (pipeline.reviewer) {
    const r = pipeline.reviewer;
    lines.push(`\n## 6. Reviewer Findings (AI)`);
    lines.push(`- **Recommended verdict:** ${r.recommendedVerdict.toUpperCase()}`);
    lines.push(`- **Summary:** ${r.summary}`);
    if (r.findings.length) {
      lines.push(`\n### Findings (${r.findings.length})`);
      for (const f of r.findings) {
        lines.push(`\n#### [${f.severity.toUpperCase()}] ${f.title}`);
        lines.push(`- **Category:** ${f.category}`);
        lines.push(`- **Confidence:** ${(f.confidence * 100).toFixed(0)}%`);
        lines.push(`- **Summary:** ${f.summary}`);
        lines.push(`- **Impact:** ${f.impact}`);
        lines.push(`- **Recommendation:** ${f.recommendation}`);
        for (const e of f.evidence) {
          const loc = e.startLine ? `:${e.startLine}–${e.endLine ?? e.startLine}` : '';
          lines.push(`- **Evidence:** \`${e.path}${loc}\` — ${e.explanation}`);
        }
        if (f.builderEvidenceRefs.length) {
          lines.push(`- **Builder refs:** ${f.builderEvidenceRefs.join(', ')}`);
        }
      }
    }
    if (r.unresolvedQuestions.length) {
      lines.push(`\n**Unresolved questions:**`);
      for (const q of r.unresolvedQuestions) lines.push(`- ${q}`);
    }
    if (r.analysisLimitations.length) {
      lines.push(`\n**Analysis limitations:**`);
      for (const l of r.analysisLimitations) lines.push(`- ${l}`);
    }
  }

  if (pipeline.judge) {
    const j = pipeline.judge;
    lines.push(`\n## 7. Judge Verdict (AI)`);
    lines.push(`- **Verdict:** ${j.verdict.toUpperCase()}`);
    lines.push(`- **Confidence:** ${(j.confidence * 100).toFixed(0)}%`);
    lines.push(`- **Summary:** ${j.summary}`);
    if (j.reasons.length) {
      lines.push(`\n**Reasons:**`);
      for (const reason of j.reasons) {
        lines.push(`- [${reason.severity.toUpperCase()}] ${reason.title}`);
        if (reason.findingIds.length)
          lines.push(`  - Finding refs: ${reason.findingIds.join(', ')}`);
        if (reason.builderEvidenceRefs.length)
          lines.push(`  - Builder refs: ${reason.builderEvidenceRefs.join(', ')}`);
      }
    }
    if (j.requiredActions.length) {
      lines.push(`\n**Required actions:**`);
      for (const a of j.requiredActions) lines.push(`- ${a}`);
    }
    if (j.dismissedFindings.length) {
      lines.push(`\n**Dismissed findings (${j.dismissedFindings.length}):**`);
      for (const d of j.dismissedFindings) {
        lines.push(`- \`${d.findingId}\`: ${d.reason}`);
      }
    }
    if (j.limitations.length) {
      lines.push(`\n**Limitations:**`);
      for (const l of j.limitations) lines.push(`- ${l}`);
    }
  }

  if (pipeline.policy) {
    const p = pipeline.policy;
    lines.push(`\n## 8. Policy Decision`);
    lines.push(`- **Mode:** ${p.mode}`);
    lines.push(`- **Decision:** ${p.decision.toUpperCase()}`);
    lines.push(`- **Exit code:** ${p.exitCode}`);
    lines.push(`- **Reason:** ${p.reason}`);
    if (p.overrideAvailable) lines.push(`- Override available`);
  }

  if (pipeline.errors.length) {
    lines.push(`\n## 9. Errors`);
    for (const e of pipeline.errors) lines.push(`- ${e}`);
  }

  lines.push(`\n---`);
  lines.push(
    `*Verik is an early verification system. It is not a guarantee of correctness or security.*`,
  );

  return lines.join('\n') + '\n';
}
