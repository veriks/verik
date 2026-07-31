import type { VerificationStage } from '../../core/pipeline/stage.js';
import type { RunContext } from '../../core/run/run-context.js';
import type { ScoutOutput } from './scout-schema.js';

export interface ScoutInput {
  context: RunContext;
}

export class ScoutStage implements VerificationStage<ScoutInput, ScoutOutput> {
  name = 'Scout';

  async execute(input: ScoutInput, _context: RunContext): Promise<ScoutOutput> {
    const { context } = input;
    const { diff } = context;

    if (!diff) {
      return this.emptyOutput('No diff available');
    }

    const provider = await this.getProvider(context);
    const { buildScoutPrompt } = await import('./scout-prompt.js');
    const prompt = buildScoutPrompt(context);

    const { ScoutOutputSchema } = await import('./scout-schema.js');
    const result = await provider.generateStructured({
      stage: 'scout',
      systemPrompt: prompt.system,
      userContent: prompt.user,
      schema: ScoutOutputSchema,
      model: context.flags.modelScout ?? context.config.models.scout,
      maxOutputTokens: 4096,
      temperature: 0.1,
      abortSignal: context.abortSignal,
    });

    return result.output;
  }

  private async getProvider(context: RunContext) {
    const { createProvider } = await import('../../inference/provider-factory.js');
    return createProvider(context.config);
  }

  private emptyOutput(reason: string): ScoutOutput {
    return {
      changeSummary: reason,
      apparentIntent: 'Unknown',
      changeType: 'unknown',
      languages: [],
      frameworks: [],
      affectedAreas: [],
      riskLevel: 'low',
      riskReasons: [],
      files: [],
      builderRecommendations: [],
      reviewFocus: [],
      uncertainties: [reason],
    };
  }
}
