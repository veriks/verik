import type { RunContext } from '../run/run-context.js';
import type { ScoutOutput } from '../../stages/scout/scout-schema.js';
import type { BuilderOutput } from '../../stages/builder/builder-schema.js';
import type { ReviewerOutput } from '../../stages/reviewer/reviewer-schema.js';
import type { JudgeOutput } from '../../stages/judge/judge-schema.js';
import type { PolicyResult } from '../policy/policy-schema.js';
import type { StageRunStatus } from '../run/run-state.js';
import type { StageMetadata } from '../../shared/schemas.js';
import { runStage } from './stage.js';
import { logger } from '../../shared/logger.js';

export interface PipelineResult {
  scout?: ScoutOutput;
  builder?: BuilderOutput;
  reviewer?: ReviewerOutput;
  judge?: JudgeOutput;
  policy?: PolicyResult;
  stageStatuses: Partial<Record<'scout' | 'builder' | 'reviewer' | 'judge', StageRunStatus>>;
  stageMetadata: Partial<Record<'scout' | 'builder' | 'reviewer' | 'judge', StageMetadata>>;
  errors: string[];
}

export async function runVerificationPipeline(context: RunContext): Promise<PipelineResult> {
  const { ScoutStage } = await import('../../stages/scout/scout-stage.js');
  const { BuilderStage } = await import('../../stages/builder/builder-stage.js');
  const { ReviewerStage } = await import('../../stages/reviewer/reviewer-stage.js');
  const { JudgeStage } = await import('../../stages/judge/judge-stage.js');
  const { evaluatePolicy } = await import('../policy/policy-engine.js');
  const p = context.progress;

  const errors: string[] = [];
  const stageStatuses: Partial<Record<'scout' | 'builder' | 'reviewer' | 'judge', StageRunStatus>> = {};
  const stageMetadata: Partial<Record<'scout' | 'builder' | 'reviewer' | 'judge', StageMetadata>> = {};
  let scout: ScoutOutput | undefined;
  let builder: BuilderOutput | undefined;
  let reviewer: ReviewerOutput | undefined;
  let judge: JudgeOutput | undefined;
  let policy: PolicyResult | undefined;

  // Scout
  stageStatuses.scout = 'running';
  p.start('Scout', 'understanding scope and risk…');
  const scoutResult = await runStage(new ScoutStage(), { context }, context);
  stageMetadata.scout = scoutResult.metadata;
  if (scoutResult.metadata.status === 'completed') {
    scout = scoutResult.output;
    stageStatuses.scout = 'completed';
    p.succeed('Scout', scoutResult.metadata.durationMs, scout.riskLevel.toUpperCase() + ' risk');
  } else {
    stageStatuses.scout = 'failed';
    errors.push(`Scout failed: ${scoutResult.metadata.error ?? 'unknown error'}`);
    p.fail('Scout', scoutResult.metadata.durationMs, 'inconclusive');
    logger.warn('Scout stage failed, continuing with partial results');
  }

  // Builder
  if (!context.flags.noBuilder) {
    stageStatuses.builder = 'running';
    p.start('Builder', 'running build/test/lint…');
    const builderResult = await runStage(new BuilderStage(), { context, scout }, context);
    stageMetadata.builder = builderResult.metadata;
    if (builderResult.metadata.status === 'completed') {
      builder = builderResult.output;
      if (builder.overallStatus === 'skipped') {
        stageStatuses.builder = 'skipped';
        p.skip('Builder', 'no commands detected');
      } else if (builderResult.metadata.fromCache) {
        stageStatuses.builder = 'completed';
        p.cached('Builder');
      } else {
        stageStatuses.builder = 'completed';
        const summary = builder.overallStatus === 'failed'
          ? `${builder.evidence.length} failure(s)`
          : builder.overallStatus;
        p.succeed('Builder', builderResult.metadata.durationMs, summary);
      }
    } else {
      stageStatuses.builder = 'failed';
      errors.push(`Builder failed: ${builderResult.metadata.error ?? 'unknown error'}`);
      p.fail('Builder', builderResult.metadata.durationMs);
    }
  } else {
    stageStatuses.builder = 'skipped';
    p.skip('Builder', '--no-builder flag');
  }

  // Reviewer
  stageStatuses.reviewer = 'running';
  p.start('Reviewer', 'analysing for correctness and security…');
  const reviewerResult = await runStage(new ReviewerStage(), { context, scout, builder }, context);
  stageMetadata.reviewer = reviewerResult.metadata;
  if (reviewerResult.metadata.status === 'completed') {
    reviewer = reviewerResult.output;
    stageStatuses.reviewer = 'completed';
    const n = reviewer.findings.length;
    const high = reviewer.findings.filter((f) => f.severity === 'high' || f.severity === 'critical').length;
    p.succeed('Reviewer', reviewerResult.metadata.durationMs, `${n} finding(s)${high ? `, ${high} high` : ''}`);
  } else {
    stageStatuses.reviewer = 'failed';
    errors.push(`Reviewer failed: ${reviewerResult.metadata.error ?? 'unknown error'}`);
    p.fail('Reviewer', reviewerResult.metadata.durationMs);
  }

  // Judge
  stageStatuses.judge = 'running';
  p.start('Judge', 'weighing evidence…');
  const judgeResult = await runStage(new JudgeStage(), { context, scout, builder, reviewer }, context);
  stageMetadata.judge = judgeResult.metadata;
  if (judgeResult.metadata.status === 'completed') {
    judge = judgeResult.output;
    stageStatuses.judge = judge.verdict === 'inconclusive' ? 'inconclusive' : 'completed';
    p.succeed('Judge', judgeResult.metadata.durationMs, `${judge.verdict.toUpperCase()} · ${Math.round(judge.confidence * 100)}% confidence`);
  } else {
    stageStatuses.judge = 'failed';
    errors.push(`Judge failed: ${judgeResult.metadata.error ?? 'unknown error'}`);
    p.fail('Judge', judgeResult.metadata.durationMs);
  }

  if (judge) {
    policy = evaluatePolicy(judge, context.policy);
  }

  return { scout, builder, reviewer, judge, policy, stageStatuses, stageMetadata, errors };
}
