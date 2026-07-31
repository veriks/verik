import Anthropic from '@anthropic-ai/sdk';
import type { ZodType } from 'zod';
import type { LlmProvider, StructuredGenerationRequest, StructuredGenerationResult } from './llm-provider.js';
import { ProviderError } from '../shared/errors.js';

export class AnthropicProvider implements LlmProvider {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey: apiKey ?? process.env['ANTHROPIC_API_KEY'] });
  }

  async generateStructured<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>> {
    const start = Date.now();
    const model = this.resolveModel(request.model, request.stage);

    const MAX_REPAIR_ATTEMPTS = 1;
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
      try {
        const response = await this.client.messages.create({
          model,
          max_tokens: request.maxOutputTokens,
          system: request.systemPrompt,
          messages: [{ role: 'user', content: request.userContent }],
          tools: [
            {
              name: 'structured_output',
              description: `Return the ${request.stage} structured output`,
              input_schema: zodToJsonSchema(request.schema) as Anthropic.Tool['input_schema'],
            },
          ],
          tool_choice: { type: 'tool', name: 'structured_output' },
        });

        const toolUse = response.content.find(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        if (!toolUse) {
          throw new ProviderError(`No tool_use block in ${request.stage} response`);
        }

        const parsed = request.schema.safeParse(toolUse.input);
        if (!parsed.success) {
          if (attempt < MAX_REPAIR_ATTEMPTS) {
            lastError = parsed.error;
            continue;
          }
          throw new ProviderError(`Schema validation failed for ${request.stage}: ${parsed.error.message}`);
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
        };
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        lastError = err;
        if (attempt >= MAX_REPAIR_ATTEMPTS) break;
      }
    }

    throw new ProviderError(`${request.stage} provider failed after retries: ${String(lastError)}`);
  }

  private resolveModel(modelConfig: string, stage: string): string {
    if (modelConfig !== 'configured-through-environment') return modelConfig;
    const envKey = `CROSSCHECK_MODEL_${stage.toUpperCase()}`;
    return process.env[envKey] ?? 'claude-sonnet-4-6';
  }
}

function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  const def = (schema as { _def?: { typeName?: string; shape?: () => Record<string, ZodType> } })._def;
  if (!def) return { type: 'object' };

  if (def.typeName === 'ZodObject' && def.shape) {
    const shape = def.shape();
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, val] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(val as ZodType);
      required.push(key);
    }
    return { type: 'object', properties, required, additionalProperties: false };
  }
  if (def.typeName === 'ZodString') return { type: 'string' };
  if (def.typeName === 'ZodNumber') return { type: 'number' };
  if (def.typeName === 'ZodBoolean') return { type: 'boolean' };
  if (def.typeName === 'ZodArray') return { type: 'array', items: zodToJsonSchema((def as { type?: ZodType }).type ?? schema) };
  if (def.typeName === 'ZodEnum') return { type: 'string', enum: (def as { values?: string[] }).values ?? [] };
  if (def.typeName === 'ZodOptional') return zodToJsonSchema((def as { innerType?: ZodType }).innerType ?? schema);
  return { type: 'string' };
}
