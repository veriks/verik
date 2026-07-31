import type { RunContext } from '../run/run-context.js';
import type { StageMetadata } from '../../shared/schemas.js';

export interface VerificationStage<TInput, TOutput> {
  name: string;
  execute(input: TInput, context: RunContext): Promise<TOutput>;
}

export interface StageResult<T> {
  output: T;
  metadata: StageMetadata;
}

export async function runStage<TInput, TOutput>(
  stage: VerificationStage<TInput, TOutput>,
  input: TInput,
  context: RunContext,
): Promise<StageResult<TOutput>> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  try {
    const output = await stage.execute(input, context);
    const completedAt = new Date().toISOString();
    return {
      output,
      metadata: {
        startedAt,
        completedAt,
        durationMs: Date.now() - start,
        status: 'completed',
      },
    };
  } catch (err) {
    const completedAt = new Date().toISOString();
    return {
      output: null as unknown as TOutput,
      metadata: {
        startedAt,
        completedAt,
        durationMs: Date.now() - start,
        status: 'failed',
        error: String(err),
      },
    };
  }
}
