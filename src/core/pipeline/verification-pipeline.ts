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
import { runDeterministicPass } from '../../stages/reviewer/deterministic-pass.js';
import type { DeterministicFinding } from '../../stages/reviewer/deterministic-rules/index.js';
import type { SuppressedFinding } from '../policy/override-engine.js';

export interface PipelineResult {
  scout?: ScoutOutput;
  builder?: BuilderOutput;
  reviewer?: ReviewerOutput;
  judge?: JudgeOutput;
  policy?: PolicyResult;
  /**
   * Deterministic rule findings. Kept separate from `reviewer.findings` so they
   * survive a Reviewer failure and can outrank model opinion, per the
   * "deterministic evidence takes precedence" invariant.
   */
  deterministicFindings: DeterministicFinding[];
  /**
   * Findings a policy or an override removed from the blocking path.
   *
   * Carried through rather than discarded so that turning a rule off can never
   * hide something without trace: the report can always say what was silenced
   * and on whose authority.
   */
  suppressedFindings: SuppressedFinding[];
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
  const stageStatuses: Partial<Record<'scout' | 'builder' | 'reviewer' | 'judge', StageRunStatus>> =
    {};
  const stageMetadata: Partial<Record<'scout' | 'builder' | 'reviewer' | 'judge', StageMetadata>> =
    {};
  let scout: ScoutOutput | undefined;
  let builder: BuilderOutput | undefined;
  let reviewer: ReviewerOutput | undefined;
  let judge: JudgeOutput | undefined;
  let policy: PolicyResult | undefined;

  // `rules` mode runs the deterministic rules and the Builder only. Both are
  // plain code, so the whole pipeline is useful with no API key — skipping the
  // inference stages deliberately is very different from letting them fail.
  const rulesOnly = context.config.mode === 'rules';
  if (rulesOnly) {
    logger.debug('Rules-only mode: skipping Scout, Reviewer and Judge.');
  }

  // Scout
  if (rulesOnly) {
    stageStatuses.scout = 'skipped';
    p.skip('Scout', 'rules-only mode');
  } else {
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
        const summary =
          builder.overallStatus === 'failed'
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

  // Deterministic rules run before the Reviewer and outside it, so their
  // findings reach the Judge and the report even if the Reviewer's LLM call fails.
  const deterministic = await runDeterministicPass(context);
  if (deterministic.findings.length) {
    logger.debug(`${deterministic.findings.length} deterministic finding(s)`);
  }

  // Reviewer
  if (rulesOnly) {
    stageStatuses.reviewer = 'skipped';
    p.skip('Reviewer', 'rules-only mode');
  } else {
    stageStatuses.reviewer = 'running';
    p.start('Reviewer', 'analysing for correctness and security…');
    const reviewerResult = await runStage(
      new ReviewerStage(),
      { context, scout, builder, deterministic },
      context,
    );
    stageMetadata.reviewer = reviewerResult.metadata;
    if (reviewerResult.metadata.status === 'completed') {
      reviewer = reviewerResult.output;
      stageStatuses.reviewer = 'completed';
      const n = reviewer.findings.length;
      const high = reviewer.findings.filter(
        (f) => f.severity === 'high' || f.severity === 'critical',
      ).length;
      p.succeed(
        'Reviewer',
        reviewerResult.metadata.durationMs,
        `${n} finding(s)${high ? `, ${high} high` : ''}`,
      );
    } else {
      stageStatuses.reviewer = 'failed';
      errors.push(`Reviewer failed: ${reviewerResult.metadata.error ?? 'unknown error'}`);
      p.fail('Reviewer', reviewerResult.metadata.durationMs);
    }
  }

  // Judge
  if (rulesOnly) {
    stageStatuses.judge = 'skipped';
    p.skip('Judge', 'rules-only mode');
  } else {
    stageStatuses.judge = 'running';
    p.start('Judge', 'weighing evidence…');
    const judgeResult = await runStage(
      new JudgeStage(),
      { context, scout, builder, reviewer, deterministicFindings: deterministic.findings },
      context,
    );
    stageMetadata.judge = judgeResult.metadata;
    if (judgeResult.metadata.status === 'completed') {
      judge = judgeResult.output;
      stageStatuses.judge = judge.verdict === 'inconclusive' ? 'inconclusive' : 'completed';
      p.succeed(
        'Judge',
        judgeResult.metadata.durationMs,
        `${judge.verdict.toUpperCase()} · ${Math.round(judge.confidence * 100)}% confidence`,
      );
    } else {
      stageStatuses.judge = 'failed';
      errors.push(`Judge failed: ${judgeResult.metadata.error ?? 'unknown error'}`);
      p.fail('Judge', judgeResult.metadata.durationMs);
    }
  }

  // Always evaluated, not only when a Judge exists. Rules mode has no Judge by
  // design, and a Judge that failed still leaves rule findings that may be
  // blocking — in both cases "no verdict" previously meant "no policy", so
  // nothing could stop a critical finding from shipping.
  policy = evaluatePolicy({
    judge,
    deterministicFindings: deterministic.findings,
    policy: context.policy,
  });

  return {
    scout,
    builder,
    reviewer,
    judge,
    policy,
    deterministicFindings: deterministic.findings,
    suppressedFindings: deterministic.suppressed,
    stageStatuses,
    stageMetadata,
    errors,
  };
}
