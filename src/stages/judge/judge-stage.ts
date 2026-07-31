import type { VerificationStage } from '../../core/pipeline/stage.js';
import type { RunContext } from '../../core/run/run-context.js';
import type { JudgeOutput } from './judge-schema.js';
import type { ScoutOutput } from '../scout/scout-schema.js';
import type { BuilderOutput } from '../builder/builder-schema.js';
import type { ReviewerOutput } from '../reviewer/reviewer-schema.js';

export interface JudgeInput {
  context: RunContext;
  scout?: ScoutOutput;
  builder?: BuilderOutput;
  reviewer?: ReviewerOutput;
}

export class JudgeStage implements VerificationStage<JudgeInput, JudgeOutput> {
  name = 'Judge';

  async execute(input: JudgeInput, _context: RunContext): Promise<JudgeOutput> {
    const { context, scout, builder, reviewer } = input;

    const provider = await this.getProvider(context);
    const { buildJudgePrompt } = await import('./judge-prompt.js');
    const prompt = buildJudgePrompt(scout, builder, reviewer, context.policy);

    const { JudgeOutputSchema } = await import('./judge-schema.js');
    const result = await provider.generateStructured({
      stage: 'judge',
      systemPrompt: prompt.system,
      userContent: prompt.user,
      schema: JudgeOutputSchema,
      model: context.flags.modelJudge ?? context.config.models.judge,
      maxOutputTokens: 4096,
      temperature: 0.05,
      abortSignal: context.abortSignal,
    });

    return result.output;
  }

  private async getProvider(context: RunContext) {
    const { createProvider } = await import('../../inference/provider-factory.js');
    return createProvider(context.config);
  }
}
