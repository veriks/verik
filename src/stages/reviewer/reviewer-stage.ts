import type { VerificationStage, StageOutputWithMeta } from '../../core/pipeline/stage.js';
import type { RunContext } from '../../core/run/run-context.js';
import type { ReviewerOutput } from './reviewer-schema.js';
import type { ScoutOutput } from '../scout/scout-schema.js';
import type { BuilderOutput } from '../builder/builder-schema.js';
import type { DeterministicPass } from './deterministic-pass.js';
import { getRecentFindings } from '../../core/memory/memory-store.js';
import type { StoredFinding } from '../../core/memory/memory-schema.js';
import { applyOverridesToLlmFindings } from '../../core/policy/override-engine.js';
import { logger } from '../../shared/logger.js';

export const REVIEWER_PROMPT_VERSION = '0.1.0';

export interface ReviewerInput {
  context: RunContext;
  scout?: ScoutOutput;
  builder?: BuilderOutput;
  /** Run by the pipeline, so these survive a Reviewer failure. */
  deterministic: DeterministicPass;
}

export class ReviewerStage implements VerificationStage<ReviewerInput, ReviewerOutput> {
  name = 'Reviewer';

  async execute(
    input: ReviewerInput,
    _context: RunContext,
  ): Promise<StageOutputWithMeta<ReviewerOutput>> {
    const { context, scout, builder, deterministic } = input;
    const { diff } = context;

    const activeOverrides = deterministic.overrides;
    const deterministicFindings = deterministic.findings;
    const suppressedDeterministic = deterministic.suppressed;

    // Query memory for historical findings on the changed files.
    const historicalFindings: StoredFinding[] = [];
    if (diff?.commandIntroducedPaths.length) {
      for (const filePath of diff.commandIntroducedPaths.slice(0, 5)) {
        try {
          const findings = await getRecentFindings(context.repoRoot, filePath, 5);
          historicalFindings.push(...findings);
        } catch (err) {
          logger.debug(`Memory query failed for ${filePath}: ${String(err)}`);
        }
      }
    }

    const provider = await this.getProvider(context);
    const { buildReviewerPrompt } = await import('./reviewer-prompt.js');
    const prompt = buildReviewerPrompt(
      context,
      scout,
      builder,
      deterministicFindings,
      historicalFindings,
    );

    const { ReviewerOutputSchema } = await import('./reviewer-schema.js');
    const result = await provider.generateStructured({
      stage: 'reviewer',
      systemPrompt: prompt.system,
      userContent: prompt.user,
      schema: ReviewerOutputSchema,
      model: context.flags.modelReviewer ?? context.config.models.reviewer,
      // Sonnet 5 thinks by default; max_tokens caps thinking + findings together.
      maxOutputTokens: 16_000,
      temperature: 0.1,
      promptVersion: REVIEWER_PROMPT_VERSION,
      timeoutMs: context.config.inferenceTimeoutMs,
      abortSignal: context.abortSignal,
    });

    // Apply overrides to LLM findings after generation — catches file-path and title-pattern matches.
    const { kept: filteredFindings, suppressed: suppressedLlm } = applyOverridesToLlmFindings(
      result.output.findings,
      activeOverrides,
    );

    if (suppressedLlm.length) {
      logger.debug(`Suppressed ${suppressedLlm.length} LLM finding(s) via overrides`);
    }

    const allSuppressed = [...suppressedDeterministic, ...suppressedLlm];
    const output: ReviewerOutput = {
      ...result.output,
      findings: filteredFindings,
      // Surface suppressed findings in analysisLimitations so the Judge knows why findings are absent.
      analysisLimitations: [
        ...result.output.analysisLimitations,
        ...allSuppressed.map(
          (s) => `Override ${s.overrideId} suppressed: "${s.title}" — ${s.reason}`,
        ),
      ],
    };

    return {
      output,
      meta: {
        model: result.model,
        provider: result.provider,
        promptVersion: REVIEWER_PROMPT_VERSION,
        promptHash: result.promptHash,
        inputHash: result.inputHash,
      },
    };
  }

  private async getProvider(context: RunContext) {
    const { createProvider } = await import('../../inference/provider-factory.js');
    return createProvider(context.config);
  }
}
