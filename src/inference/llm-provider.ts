import { z } from 'zod';
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
  abortSignal?: AbortSignal;
}

export interface StructuredGenerationResult<T> {
  output: T;
  tokenUsage?: TokenUsage;
  durationMs: number;
  provider: string;
  model: string;
}

export interface LlmProvider {
  generateStructured<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>>;
}
