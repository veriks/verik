import type { RunContext } from '../run/run-context.js';
import type { StageMetadata } from '../../shared/schemas.js';

/** Stages may return raw output or a tagged object carrying inference metadata. */
export interface StageOutputWithMeta<T> {
  output: T;
  meta?: {
    model?: string;
    provider?: string;
    promptVersion?: string;
    promptHash?: string;
    inputHash?: string;
    fromCache?: boolean;
  };
}

export interface VerificationStage<TInput, TOutput> {
  name: string;
  execute(input: TInput, context: RunContext): Promise<TOutput | StageOutputWithMeta<TOutput>>;
}

export interface StageResult<T> {
  output: T;
  metadata: StageMetadata;
}

function isTagged<T>(v: unknown): v is StageOutputWithMeta<T> {
  return typeof v === 'object' && v !== null && 'output' in v && 'meta' in v;
}

export async function runStage<TInput, TOutput>(
  stage: VerificationStage<TInput, TOutput>,
  input: TInput,
  context: RunContext,
): Promise<StageResult<TOutput>> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  try {
    const raw = await stage.execute(input, context);
    const completedAt = new Date().toISOString();

    if (isTagged<TOutput>(raw)) {
      return {
        output: raw.output,
        metadata: {
          startedAt,
          completedAt,
          durationMs: Date.now() - start,
          status: 'completed',
          ...raw.meta,
        },
      };
    }

    return {
      output: raw as TOutput,
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
