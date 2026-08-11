import { zodToJsonSchema as _zodToJsonSchema } from 'zod-to-json-schema';
import type {
  LlmProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from './llm-provider.js';
import { ProviderError } from '../shared/errors.js';
import { sha256 } from '../shared/hashing.js';
import { logger } from '../shared/logger.js';

/**
 * One implementation for every provider that speaks OpenAI's
 * `/chat/completions` — OpenAI, Google, Mistral, DeepSeek, Groq, Together,
 * Fireworks, OpenRouter, Hugging Face, and local runtimes like Ollama.
 *
 * Uses fetch rather than an SDK on purpose: the SDK would add a dependency for
 * one endpoint, and hosts differ in which optional fields they accept, so the
 * request shape needs to stay under our control.
 *
 * Structured output support varies across those hosts, so this degrades in
 * three steps rather than assuming the strictest mode works:
 *   1. `response_format: json_schema` with strict validation
 *   2. `response_format: json_object` with the schema in the prompt
 *   3. plain completion, extracting the first JSON object in the text
 * Zod validates the result in every case, so a host that silently ignores the
 * request is caught rather than trusted.
 */

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string };
}

type Mode = 'json_schema' | 'json_object' | 'text';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Pulls the first balanced JSON object out of prose, for hosts that wrap it in commentary. */
function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf('{');
  if (start === -1) return body.trim();

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return body.slice(start, i + 1);
  }
  return body.slice(start).trim();
}

export class OpenAICompatibleProvider implements LlmProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly providerId: string,
  ) {}

  async generateStructured<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>> {
    const start = Date.now();
    const promptHash = sha256(request.systemPrompt);
    const inputHash = sha256(request.userContent);

    const rawSchema = _zodToJsonSchema(request.schema, { target: 'jsonSchema7' }) as Record<
      string,
      unknown
    >;
    const schema = { ...rawSchema };
    delete schema['$schema'];

    let mode: Mode = 'json_schema';
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt - 1));
      }

      try {
        const text = await this.call(request, schema, mode);
        const parsed: unknown = JSON.parse(mode === 'text' ? extractJson(text) : text);
        const output = request.schema.parse(parsed);

        return {
          output,
          durationMs: Date.now() - start,
          provider: this.providerId,
          model: request.model,
          promptHash,
          inputHash,
          tokenUsage: this.lastUsage,
        };
      } catch (err) {
        lastError = err;

        // A host that rejects the stricter mode is telling us to step down,
        // not to give up. Do that immediately rather than burning a retry.
        const next = this.downgrade(mode, err);
        if (next !== mode) {
          logger.debug(
            `${this.providerId}: ${mode} unsupported, falling back to ${next} (${String(err)})`,
          );
          mode = next;
          attempt--; // the downgrade is not itself a failed attempt
          continue;
        }
        if (!this.isRetryable(err)) break;
      }
    }

    throw new ProviderError(
      `${this.providerId} request failed for ${request.stage}: ${String(lastError)}`,
    );
  }

  private lastUsage: { inputTokens?: number; outputTokens?: number } | undefined;

  private downgrade(mode: Mode, err: unknown): Mode {
    const msg = String(err).toLowerCase();
    const unsupported =
      msg.includes('response_format') ||
      msg.includes('json_schema') ||
      msg.includes('not supported') ||
      msg.includes('unsupported') ||
      msg.includes('invalid_request');
    if (!unsupported) return mode;
    if (mode === 'json_schema') return 'json_object';
    if (mode === 'json_object') return 'text';
    return mode;
  }

  private isRetryable(err: unknown): boolean {
    const msg = String(err);
    return (
      /\b(429|500|502|503|504|529)\b/.test(msg) ||
      /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(msg)
    );
  }

  private async call<T>(
    request: StructuredGenerationRequest<T>,
    schema: Record<string, unknown>,
    mode: Mode,
  ): Promise<string> {
    const timeout = AbortSignal.timeout(request.timeoutMs ?? 120_000);
    const signal = request.abortSignal ? AbortSignal.any([request.abortSignal, timeout]) : timeout;

    // In the two fallback modes the model has no schema unless we supply one.
    const system =
      mode === 'json_schema'
        ? request.systemPrompt
        : `${request.systemPrompt}\n\nRespond with a single JSON object and nothing else. It must conform to this JSON Schema:\n${JSON.stringify(schema)}`;

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxOutputTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: request.userContent },
      ],
    };

    if (mode === 'json_schema') {
      body['response_format'] = {
        type: 'json_schema',
        json_schema: { name: `${request.stage}_output`, schema, strict: true },
      };
    } else if (mode === 'json_object') {
      body['response_format'] = { type: 'json_object' };
    }

    // Node's fetch keeps sockets alive by default. The CLI calls process.exit
    // as soon as a verdict is in, and on Windows tearing down a live keep-alive
    // handle mid-close trips a libuv assertion:
    //   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\winsync.c
    // A CLI makes three requests and leaves, so there is nothing to reuse the
    // connection for.
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      connection: 'close',
    };
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    const payload = (await res.json().catch(() => ({}))) as ChatResponse;

    if (!res.ok) {
      const detail = payload.error?.message ?? JSON.stringify(payload).slice(0, 300);
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError(
          `${this.providerId} rejected the API key (${res.status}). Check the key and its permissions.`,
        );
      }
      if (res.status === 404) {
        throw new ProviderError(
          `${this.providerId} has no model "${request.model}" (404). Check the model id in .verik/config.json.`,
        );
      }
      throw new Error(`${res.status}: ${detail}`);
    }

    this.lastUsage = {
      inputTokens: payload.usage?.prompt_tokens,
      outputTokens: payload.usage?.completion_tokens,
    };

    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('empty completion');
    return content;
  }
}
