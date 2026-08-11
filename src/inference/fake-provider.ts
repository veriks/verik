import type {
  LlmProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from './llm-provider.js';
import { ProviderError } from '../shared/errors.js';

export class FakeProvider implements LlmProvider {
  async generateStructured<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>> {
    throw new ProviderError(
      `No provider configured for stage ${request.stage}. Set the API key for your ` +
        `configured provider — run \`verik doctor\` to see which variable that is.`,
    );
  }
}
