import type { VerificationStage } from '../../core/pipeline/stage.js';
import type { RunContext } from '../../core/run/run-context.js';
import type { ReviewerOutput } from './reviewer-schema.js';
import type { ScoutOutput } from '../scout/scout-schema.js';
import type { BuilderOutput } from '../builder/builder-schema.js';
import { runDeterministicRules } from './deterministic-rules/index.js';

export interface ReviewerInput {
  context: RunContext;
  scout?: ScoutOutput;
  builder?: BuilderOutput;
}

export class ReviewerStage implements VerificationStage<ReviewerInput, ReviewerOutput> {
  name = 'Reviewer';

  async execute(input: ReviewerInput, _context: RunContext): Promise<ReviewerOutput> {
    const { context, scout, builder } = input;
    const { diff } = context;

    const deterministicFindings = diff
      ? await runDeterministicRules({ diff, patch: diff.patch })
      : [];

    const provider = await this.getProvider(context);
    const { buildReviewerPrompt } = await import('./reviewer-prompt.js');
    const prompt = buildReviewerPrompt(context, scout, builder, deterministicFindings);

    const { ReviewerOutputSchema } = await import('./reviewer-schema.js');
    const result = await provider.generateStructured({
      stage: 'reviewer',
      systemPrompt: prompt.system,
      userContent: prompt.user,
      schema: ReviewerOutputSchema,
      model: context.flags.modelReviewer ?? context.config.models.reviewer,
      maxOutputTokens: 8192,
      temperature: 0.1,
      abortSignal: context.abortSignal,
    });

    return result.output;
  }

  private async getProvider(context: RunContext) {
    const { createProvider } = await import('../../inference/provider-factory.js');
    return createProvider(context.config);
  }
}
