import type { RunContext } from '../run/run-context.js';
import type { PipelineResult } from '../pipeline/verification-pipeline.js';
import { saveRun, saveFinding } from './memory-store.js';
import { logger } from '../../shared/logger.js';

/**
 * Persists a completed run and its confirmed findings to the memory store.
 *
 * Called by the orchestrator after every verification run.
 * The memory store is used in future runs to surface historical context:
 *
 *   Reviewer
 *     ↓
 *   Memory
 *     ↓
 *   "This file had a broken auth pattern three times before."
 */
export async function recordRun(context: RunContext, pipeline: PipelineResult): Promise<void> {
  const { repoRoot, record, diff } = context;
  const judge = pipeline.judge;
  const reviewer = pipeline.reviewer;

  try {
    await saveRun(repoRoot, {
      runId: record.runId,
      repositoryPath: record.repositoryPath,
      repositoryRemote: record.repositoryRemote,
      branch: record.branch,
      baselineCommitSha: record.baselineCommitSha,
      timestamp: record.startedAt,
      wrappedCommand: record.wrappedCommand,
      verdict: judge?.verdict,
      confidence: judge?.confidence,
      findingCount: reviewer?.findings.length ?? 0,
      highSeverityCount: reviewer?.findings.filter(
        (f) => f.severity === 'high' || f.severity === 'critical',
      ).length ?? 0,
      builderStatus: pipeline.builder?.overallStatus,
    });

    if (reviewer && judge) {
      const dismissedIds = new Set(judge.dismissedFindings.map((d) => d.findingId));
      for (const finding of reviewer.findings) {
        const disposed = dismissedIds.has(finding.id) ? 'dismissed' : 'confirmed';
        const dismissEntry = judge.dismissedFindings.find((d) => d.findingId === finding.id);
        await saveFinding(repoRoot, {
          runId: record.runId,
          repositoryPath: record.repositoryPath,
          repositoryRemote: record.repositoryRemote,
          branch: record.branch,
          commitSha: record.baselineCommitSha,
          timestamp: record.startedAt,
          ruleId: undefined,
          title: finding.title,
          category: finding.category,
          severity: finding.severity,
          confidence: finding.confidence,
          filePath: finding.evidence[0]?.path,
          startLine: finding.evidence[0]?.startLine,
          summary: finding.summary,
          recommendation: finding.recommendation,
          judgeVerdict: judge.verdict,
          judgeDisposed: disposed,
          dismissReason: dismissEntry?.reason,
          escaped: false,
        });
      }
    }
  } catch (err) {
    // Memory errors must never fail a run
    logger.warn(`Memory recording failed (non-fatal): ${String(err)}`);
  }
}
