import type { LlmProvider } from './llm-provider.js';
import type { VerikConfig } from '../config/config-schema.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import { FakeProvider } from './fake-provider.js';
import { PROVIDERS, resolveApiKey } from './providers.js';
import { logger } from '../shared/logger.js';

/**
 * Anthropic has a native implementation because its structured output uses
 * tool_use; every other supported provider speaks OpenAI-compatible
 * `/chat/completions`, so they share one implementation differing only in base
 * URL and key.
 *
 * Returns FakeProvider — which throws on use — when no key is configured. The
 * pipeline already treats a failing stage as inconclusive rather than passing,
 * so a missing key degrades honestly instead of inventing a verdict.
 */
export function createProvider(config: VerikConfig): LlmProvider {
  const spec = PROVIDERS[config.provider];
  if (!spec) {
    logger.warn(`Unknown provider "${config.provider}" — LLM stages will not run.`);
    return new FakeProvider();
  }

  const apiKey = resolveApiKey(spec);
  if (!apiKey && !spec.keyOptional) {
    return new FakeProvider();
  }

  if (spec.id === 'anthropic') {
    return new AnthropicProvider(apiKey);
  }

  const baseUrl = config.baseUrl ?? spec.baseUrl;
  if (!baseUrl) {
    logger.warn(
      `Provider "${spec.id}" has no endpoint. Set baseUrl in .verik/config.json ` +
        'or VERIK_BASE_URL.',
    );
    return new FakeProvider();
  }

  // A custom endpoint carries no default model ids, so an unconfigured one
  // would post `"model": ""` and come back with a provider-specific error that
  // says nothing about the actual cause.
  const missing = (['scout', 'reviewer', 'judge'] as const).filter(
    (s) => !config.models[s]?.trim(),
  );
  if (missing.length > 0) {
    logger.warn(
      `No model id configured for: ${missing.join(', ')}. Set "models" in ` +
        '.verik/config.json or VERIK_MODEL_{SCOUT,REVIEWER,JUDGE}.',
    );
    return new FakeProvider();
  }

  return new OpenAICompatibleProvider(baseUrl, apiKey, spec.id);
}
