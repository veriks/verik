import type { RunContext } from '../run/run-context.js';
import type { PipelineResult } from '../pipeline/verification-pipeline.js';
import { saveRunJson, saveRunFile } from '../../storage/local-run-store.js';
import { renderReport } from './report-renderer.js';
import { renderHtmlReport } from './report-renderer-html.js';
import { createEvidenceStore, addEvidence } from './evidence-store.js';
import { redactCommandLine } from '../../shared/redaction.js';

export async function buildAndSaveReport(
  context: RunContext,
  pipeline: PipelineResult,
): Promise<void> {
  const { repoRoot, runId } = context;

  const evidence = createEvidenceStore();

  if (pipeline.builder) {
    for (const cmd of pipeline.builder.commands) {
      if (cmd.status !== 'passed' && cmd.status !== 'skipped') {
        addEvidence(evidence, {
          kind: 'builder-command',
          excerpt: cmd.stderrTail || cmd.stdoutTail,
          command: cmd.command,
        });
      }
    }
  }

  // Reports get attached to CI runs and pasted into issues — sanitised, not raw.
  if (context.diff?.safePatch) {
    addEvidence(evidence, {
      kind: 'diff-excerpt',
      excerpt: context.diff.safePatch.slice(0, 2000),
    });
  }

  const report = {
    runId,
    generatedAt: new Date().toISOString(),
    wrappedCommand: redactCommandLine(context.wrappedCommand),
    intent: context.intent,
    repository: {
      path: context.repoRoot,
      repoId: context.repoId,
      branch: context.record.branch,
      baselineCommit: context.record.baselineCommitSha,
    },
    attributableDiff: {
      changedFiles: context.diff?.changedFiles ?? [],
      additions: context.diff?.additions ?? 0,
      deletions: context.diff?.deletions ?? 0,
      preExistingPaths: context.diff?.preExistingChangedPaths ?? [],
      commandIntroducedPaths: context.diff?.commandIntroducedPaths ?? [],
      truncated: context.diff?.truncated ?? false,
    },
    stages: {
      scout: stageRecord(pipeline, 'scout'),
      builder: stageRecord(pipeline, 'builder'),
      reviewer: stageRecord(pipeline, 'reviewer'),
      judge: stageRecord(pipeline, 'judge'),
    },
    // Recorded alongside, not merged into, the Reviewer's findings: these are
    // rule output rather than model output, and they exist even when the
    // Reviewer stage failed entirely.
    deterministicFindings: pipeline.deterministicFindings,
    evidence: evidence.items,
    policy: pipeline.policy,
    errors: pipeline.errors,
  };

  await saveRunJson(repoRoot, runId, 'report.json', report);
  await saveRunJson(repoRoot, runId, 'evidence.json', evidence.items);

  const md = renderReport(context, pipeline);
  const html = renderHtmlReport(context, pipeline);
  await saveRunFile(repoRoot, runId, 'report.md', md);
  await saveRunFile(repoRoot, runId, 'report.html', html);

  // Individual stage files carry both output and full inference metadata —
  // model, provider, promptVersion, promptHash, inputHash, token usage, duration.
  // crosscheck inspect reads these directly.
  const sm = pipeline.stageMetadata;
  if (pipeline.scout)
    await saveRunJson(repoRoot, runId, 'scout.json', { ...sm.scout, output: pipeline.scout });
  if (pipeline.builder)
    await saveRunJson(repoRoot, runId, 'builder.json', { ...sm.builder, output: pipeline.builder });
  if (pipeline.reviewer)
    await saveRunJson(repoRoot, runId, 'reviewer.json', {
      ...sm.reviewer,
      output: pipeline.reviewer,
    });
  if (pipeline.judge)
    await saveRunJson(repoRoot, runId, 'judge.json', { ...sm.judge, output: pipeline.judge });
  if (pipeline.deterministicFindings.length) {
    await saveRunJson(repoRoot, runId, 'deterministic.json', pipeline.deterministicFindings);
  }
}

function stageRecord(pipeline: PipelineResult, stage: 'scout' | 'builder' | 'reviewer' | 'judge') {
  return {
    ...(pipeline.stageMetadata[stage] ?? {}),
    output: pipeline[stage],
  };
}
