import type { RunContext } from '../run/run-context.js';
import type { ScoutOutput } from '../../stages/scout/scout-schema.js';
import type { BuilderOutput } from '../../stages/builder/builder-schema.js';
import type { ReviewerOutput } from '../../stages/reviewer/reviewer-schema.js';
import type { JudgeOutput } from '../../stages/judge/judge-schema.js';
import type { PolicyResult } from '../policy/policy-schema.js';
import type { StageRunStatus } from '../run/run-state.js';
import { runStage } from './stage.js';
import { logger } from '../../shared/logger.js';

export interface PipelineResult {
  scout?: ScoutOutput;
  builder?: BuilderOutput;
  reviewer?: ReviewerOutput;
  judge?: JudgeOutput;
  policy?: PolicyResult;
  stageStatuses: Partial<Record<'scout' | 'builder' | 'reviewer' | 'judge', StageRunStatus>>;
  errors: string[];
}

export async function runVerificationPipeline(context: RunContext): Promise<PipelineResult> {
  const { ScoutStage } = await import('../../stages/scout/scout-stage.js');
  const { BuilderStage } = await import('../../stages/builder/builder-stage.js');
  const { ReviewerStage } = await import('../../stages/reviewer/reviewer-stage.js');
  const { JudgeStage } = await import('../../stages/judge/judge-stage.js');
  const { evaluatePolicy } = await import('../policy/policy-engine.js');

  const errors: string[] = [];
  const stageStatuses: Partial<Record<'scout' | 'builder' | 'reviewer' | 'judge', StageRunStatus>> = {};
  let scout: ScoutOutput | undefined;
  let builder: BuilderOutput | undefined;
  let reviewer: ReviewerOutput | undefined;
  let judge: JudgeOutput | undefined;
  let policy: PolicyResult | undefined;

  logger.debug('Running Scout stage');
  stageStatuses.scout = 'running';
  const scoutResult = await runStage(new ScoutStage(), { context }, context);
  if (scoutResult.metadata.status === 'completed') {
    scout = scoutResult.output;
    stageStatuses.scout = 'completed';
  } else {
    stageStatuses.scout = 'failed';
    errors.push(`Scout failed: ${scoutResult.metadata.error ?? 'unknown error'}`);
    logger.warn('Scout stage failed, continuing with partial results');
  }

  if (!context.flags.noBuilder) {
    logger.debug('Running Builder stage (deterministic)');
    stageStatuses.builder = 'running';
    const builderResult = await runStage(new BuilderStage(), { context, scout }, context);
    if (builderResult.metadata.status === 'completed') {
      builder = builderResult.output;
      stageStatuses.builder = builder.overallStatus === 'skipped' ? 'skipped' : 'completed';
    } else {
      stageStatuses.builder = 'failed';
      errors.push(`Builder failed: ${builderResult.metadata.error ?? 'unknown error'}`);
    }
  } else {
    stageStatuses.builder = 'skipped';
  }

  logger.debug('Running Reviewer stage');
  stageStatuses.reviewer = 'running';
  const reviewerResult = await runStage(new ReviewerStage(), { context, scout, builder }, context);
  if (reviewerResult.metadata.status === 'completed') {
    reviewer = reviewerResult.output;
    stageStatuses.reviewer = 'completed';
  } else {
    stageStatuses.reviewer = 'failed';
    errors.push(`Reviewer failed: ${reviewerResult.metadata.error ?? 'unknown error'}`);
  }

  logger.debug('Running Judge stage');
  stageStatuses.judge = 'running';
  const judgeResult = await runStage(new JudgeStage(), { context, scout, builder, reviewer }, context);
  if (judgeResult.metadata.status === 'completed') {
    judge = judgeResult.output;
    stageStatuses.judge = judge.verdict === 'inconclusive' ? 'inconclusive' : 'completed';
  } else {
    stageStatuses.judge = 'failed';
    errors.push(`Judge failed: ${judgeResult.metadata.error ?? 'unknown error'}`);
  }

  if (judge) {
    policy = evaluatePolicy(judge, context.policy);
  }

  return { scout, builder, reviewer, judge, policy, stageStatuses, errors };
}
