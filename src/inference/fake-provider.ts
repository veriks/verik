import type { LlmProvider, StructuredGenerationRequest, StructuredGenerationResult } from './llm-provider.js';
import { ProviderError } from '../shared/errors.js';

export class FakeProvider implements LlmProvider {
  async generateStructured<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>> {
    throw new ProviderError(
      `No real provider configured. Stage: ${request.stage}. Set ANTHROPIC_API_KEY and configure a model.`,
    );
  }
}
