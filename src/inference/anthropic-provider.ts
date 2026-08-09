import Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema as _zodToJsonSchema } from 'zod-to-json-schema';
import type {
  LlmProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from './llm-provider.js';
import { ProviderError } from '../shared/errors.js';
import { sha256 } from '../shared/hashing.js';
import { logger } from '../shared/logger.js';

const TRANSIENT_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']);
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

export class AnthropicProvider implements LlmProvider {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env['ANTHROPIC_API_KEY'],
      maxRetries: 0, // We handle retries ourselves for better error messages.
    });
  }

  async generateStructured<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>> {
    const start = Date.now();
    const model = this.resolveModel(request.model, request.stage);
    const promptHash = sha256(request.systemPrompt);
    const inputHash = sha256(request.userContent);

    const rawSchema = _zodToJsonSchema(request.schema, { target: 'jsonSchema7' }) as Record<
      string,
      unknown
    >;
    const inputSchema = { ...rawSchema };
    delete inputSchema['$schema'];

    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        logger.debug(
          `Retrying ${request.stage} (attempt ${attempt + 1}/${MAX_RETRIES}) after ${delay}ms`,
        );
        await sleep(delay);
      }

      try {
        // Per-call timeout via AbortController. The caller's abortSignal may already
        // be set (e.g. user Ctrl-C) — we race both signals.
        const timeoutMs = request.timeoutMs ?? 120_000;
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

        const signal = anyAbort(request.abortSignal, timeoutController.signal);

        let response: Awaited<ReturnType<typeof this.client.messages.create>>;
        try {
          response = await this.client.messages.create(
            {
              model,
              max_tokens: request.maxOutputTokens,
              system: request.systemPrompt,
              messages: [{ role: 'user', content: request.userContent }],
              tools: [
                {
                  name: 'structured_output',
                  description: `Return the ${request.stage} structured output`,
                  input_schema: inputSchema as Anthropic.Tool['input_schema'],
                },
              ],
              tool_choice: { type: 'tool', name: 'structured_output' },
            },
            { signal },
          );
        } finally {
          clearTimeout(timeoutId);
        }

        const toolUse = response.content.find(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        if (!toolUse) {
          throw new ProviderError(`No tool_use block in ${request.stage} response`);
        }

        const parsed = request.schema.safeParse(toolUse.input);
        if (!parsed.success) {
          // One schema repair attempt — send the validation error back to the model.
          logger.debug(`${request.stage} schema validation failed, attempting repair`);
          const repairResponse = await this.client.messages.create(
            {
              model,
              max_tokens: request.maxOutputTokens,
              system: request.systemPrompt,
              messages: [
                { role: 'user', content: request.userContent },
                { role: 'assistant', content: response.content },
                {
                  role: 'user',
                  content: `Your previous response failed schema validation: ${parsed.error.message}\n\nPlease call structured_output again with corrected output.`,
                },
              ],
              tools: [
                {
                  name: 'structured_output',
                  description: `Return the ${request.stage} structured output`,
                  input_schema: inputSchema as Anthropic.Tool['input_schema'],
                },
              ],
              tool_choice: { type: 'tool', name: 'structured_output' },
            },
            { signal: request.abortSignal },
          );

          const repairTool = repairResponse.content.find(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
          );
          const repaired = repairTool ? request.schema.safeParse(repairTool.input) : null;
          if (!repaired?.success) {
            throw new ProviderError(
              `${request.stage} schema validation failed after repair attempt: ${parsed.error.message}`,
            );
          }
          return {
            output: repaired.data,
            tokenUsage: {
              inputTokens:
                (response.usage.input_tokens ?? 0) + (repairResponse.usage.input_tokens ?? 0),
              outputTokens:
                (response.usage.output_tokens ?? 0) + (repairResponse.usage.output_tokens ?? 0),
            },
            durationMs: Date.now() - start,
            provider: 'anthropic',
            model,
            promptHash,
            inputHash,
          };
        }

        return {
          output: parsed.data,
          tokenUsage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
          durationMs: Date.now() - start,
          provider: 'anthropic',
          model,
          promptHash,
          inputHash,
        };
      } catch (err) {
        // Never retry on these — they won't resolve with more attempts.
        if (err instanceof ProviderError) throw err;
        if (err instanceof Anthropic.AuthenticationError) {
          throw new ProviderError(
            `Authentication failed — check that ANTHROPIC_API_KEY is set correctly and has not expired.`,
          );
        }
        if (err instanceof Anthropic.PermissionDeniedError) {
          throw new ProviderError(
            `Permission denied for model "${this.resolveModel(request.model, request.stage)}" — the API key may not have access to this model.`,
          );
        }
        if (err instanceof Anthropic.NotFoundError) {
          throw new ProviderError(
            `Model not found: "${this.resolveModel(request.model, request.stage)}" — check CROSSCHECK_MODEL_${request.stage.toUpperCase()} or the config file.`,
          );
        }
        if (isAbortError(err)) {
          const elapsed = Date.now() - start;
          if (elapsed >= (request.timeoutMs ?? 120_000) - 100) {
            throw new ProviderError(
              `${request.stage} timed out after ${Math.round(elapsed / 1000)}s — increase inferenceTimeoutMs in config if the diff is large.`,
            );
          }
          throw new ProviderError(`${request.stage} was cancelled.`);
        }

        // Retry on rate limits, server errors, and network errors.
        if (
          err instanceof Anthropic.RateLimitError ||
          err instanceof Anthropic.InternalServerError ||
          err instanceof Anthropic.APIConnectionError ||
          isTransientNetworkError(err)
        ) {
          lastError = err;
          logger.debug(`${request.stage} transient error (attempt ${attempt + 1}): ${String(err)}`);
          continue;
        }

        // Unknown error — don't retry.
        throw new ProviderError(`${request.stage} failed: ${String(err)}`);
      }
    }

    throw new ProviderError(
      `${request.stage} failed after ${MAX_RETRIES} attempts: ${String(lastError)}`,
    );
  }

  private resolveModel(modelConfig: string, stage: string): string {
    if (modelConfig !== 'configured-through-environment') return modelConfig;
    const envKey = `CROSSCHECK_MODEL_${stage.toUpperCase()}`;
    return process.env[envKey] ?? 'claude-sonnet-4-6';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' ||
      err.message.includes('aborted') ||
      err.message.includes('cancelled'))
  );
}

function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code ?? '';
  return TRANSIENT_ERROR_CODES.has(code);
}

/** Returns an AbortSignal that fires when any of the provided signals abort. */
function anyAbort(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
