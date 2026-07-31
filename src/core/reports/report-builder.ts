import type { RunContext } from '../run/run-context.js';
import type { PipelineResult } from '../pipeline/verification-pipeline.js';
import { saveRunJson, saveRunFile } from '../../storage/local-run-store.js';
import { renderReport } from './report-renderer.js';
import {
  createEvidenceStore,
  addEvidence,
} from './evidence-store.js';

export async function buildAndSaveReport(
  context: RunContext,
  pipeline: PipelineResult,
): Promise<void> {
  const { repoRoot, runId } = context;

  // Build evidence store — findings reference stable IDs
  const evidence = createEvidenceStore();

  // Index builder command evidence
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

  // Index diff excerpt as evidence
  if (context.diff?.patch) {
    addEvidence(evidence, {
      kind: 'diff-excerpt',
      excerpt: context.diff.patch.slice(0, 2000),
    });
  }

  const report = {
    runId,
    generatedAt: new Date().toISOString(),
    wrappedCommand: context.wrappedCommand,
    intent: context.intent,
    repository: {
      path: context.repoRoot,
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
      scout: { status: pipeline.stageStatuses.scout, output: pipeline.scout },
      builder: { status: pipeline.stageStatuses.builder, output: pipeline.builder },
      reviewer: { status: pipeline.stageStatuses.reviewer, output: pipeline.reviewer },
      judge: { status: pipeline.stageStatuses.judge, output: pipeline.judge },
    },
    evidence: evidence.items,
    policy: pipeline.policy,
    errors: pipeline.errors,
  };

  await saveRunJson(repoRoot, runId, 'report.json', report);
  await saveRunJson(repoRoot, runId, 'evidence.json', evidence.items);

  const md = renderReport(context, pipeline);
  await saveRunFile(repoRoot, runId, 'report.md', md);

  if (pipeline.scout) await saveRunJson(repoRoot, runId, 'scout.json', { status: pipeline.stageStatuses.scout, output: pipeline.scout });
  if (pipeline.builder) await saveRunJson(repoRoot, runId, 'builder.json', { status: pipeline.stageStatuses.builder, output: pipeline.builder });
  if (pipeline.reviewer) await saveRunJson(repoRoot, runId, 'reviewer.json', { status: pipeline.stageStatuses.reviewer, output: pipeline.reviewer });
  if (pipeline.judge) await saveRunJson(repoRoot, runId, 'judge.json', { status: pipeline.stageStatuses.judge, output: pipeline.judge });
}
