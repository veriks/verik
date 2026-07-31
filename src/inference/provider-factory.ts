import type { LlmProvider } from './llm-provider.js';
import type { CrosscheckConfig } from '../config/config-schema.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { FakeProvider } from './fake-provider.js';

export function createProvider(config: CrosscheckConfig): LlmProvider {
  if (!process.env['ANTHROPIC_API_KEY']) {
    return new FakeProvider();
  }
  if (config.provider === 'anthropic') {
    return new AnthropicProvider();
  }
  return new FakeProvider();
}
