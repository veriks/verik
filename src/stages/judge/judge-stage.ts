import type { VerificationStage, StageOutputWithMeta } from '../../core/pipeline/stage.js';
import type { RunContext } from '../../core/run/run-context.js';
import type { JudgeOutput } from './judge-schema.js';
import type { ScoutOutput } from '../scout/scout-schema.js';
import type { BuilderOutput } from '../builder/builder-schema.js';
import type { ReviewerOutput } from '../reviewer/reviewer-schema.js';
import type { DeterministicFinding } from '../reviewer/deterministic-rules/index.js';

export const JUDGE_PROMPT_VERSION = '0.1.0';

export interface JudgeInput {
  context: RunContext;
  scout?: ScoutOutput;
  builder?: BuilderOutput;
  reviewer?: ReviewerOutput;
  /** Rule output, not model output — the Judge must weigh these as fact. */
  deterministicFindings?: DeterministicFinding[];
}

export class JudgeStage implements VerificationStage<JudgeInput, JudgeOutput> {
  name = 'Judge';

  async execute(
    input: JudgeInput,
    _context: RunContext,
  ): Promise<StageOutputWithMeta<JudgeOutput>> {
    const { context, scout, builder, reviewer } = input;

    const provider = await this.getProvider(context);
    const { buildJudgePrompt } = await import('./judge-prompt.js');
    const prompt = buildJudgePrompt(
      scout,
      builder,
      reviewer,
      context.policy,
      input.deterministicFindings ?? [],
    );

    const { JudgeOutputSchema } = await import('./judge-schema.js');
    const result = await provider.generateStructured({
      stage: 'judge',
      systemPrompt: prompt.system,
      userContent: prompt.user,
      schema: JudgeOutputSchema,
      model: context.flags.modelJudge ?? context.config.models.judge,
      // Opus 5 thinks by default and max_tokens caps thinking + response
      // together — a tight budget truncates the verdict mid-sentence.
      maxOutputTokens: 16_000,
      temperature: 0.05,
      promptVersion: JUDGE_PROMPT_VERSION,
      timeoutMs: context.config.inferenceTimeoutMs,
      abortSignal: context.abortSignal,
    });

    return {
      output: result.output,
      meta: {
        model: result.model,
        provider: result.provider,
        promptVersion: JUDGE_PROMPT_VERSION,
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
