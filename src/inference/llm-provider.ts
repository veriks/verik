import type { ZodType } from 'zod';
import type { TokenUsage } from '../shared/schemas.js';

export interface StructuredGenerationRequest<T> {
  stage: string;
  systemPrompt: string;
  userContent: string;
  schema: ZodType<T>;
  model: string;
  maxOutputTokens: number;
  temperature: number;
  promptVersion: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

export interface StructuredGenerationResult<T> {
  output: T;
  tokenUsage?: TokenUsage;
  durationMs: number;
  provider: string;
  model: string;
  promptHash: string; // SHA256 of systemPrompt — stable identity for this prompt version
  inputHash: string; // SHA256 of userContent — lets you detect same-input/different-output
}

export interface LlmProvider {
  generateStructured<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>>;
}
