import type { VerificationStage, StageOutputWithMeta } from '../../core/pipeline/stage.js';
import type { RunContext } from '../../core/run/run-context.js';
import type { ScoutOutput } from './scout-schema.js';

export const SCOUT_PROMPT_VERSION = '0.1.0';

export interface ScoutInput {
  context: RunContext;
}

export class ScoutStage implements VerificationStage<ScoutInput, ScoutOutput> {
  name = 'Scout';

  async execute(input: ScoutInput, _context: RunContext): Promise<StageOutputWithMeta<ScoutOutput>> {
    const { context } = input;
    const { diff } = context;

    if (!diff) {
      return { output: this.emptyOutput('No diff available') };
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
      promptVersion: SCOUT_PROMPT_VERSION,
      timeoutMs: context.config.inferenceTimeoutMs,
      abortSignal: context.abortSignal,
    });

    return {
      output: result.output,
      meta: {
        model: result.model,
        provider: result.provider,
        promptVersion: SCOUT_PROMPT_VERSION,
        promptHash: result.promptHash,
        inputHash: result.inputHash,
      },
    };
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
