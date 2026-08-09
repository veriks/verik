import { z } from 'zod';

export const SeveritySchema = z.enum(['info', 'low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof SeveritySchema>;

export const VerdictSchema = z.enum(['pass', 'warn', 'block', 'inconclusive']);
export type Verdict = z.infer<typeof VerdictSchema>;

export const PolicyDecisionSchema = z.enum(['allow', 'warn', 'deny']);
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const PolicyModeSchema = z.enum(['shadow', 'advisory', 'blocking']);
export type PolicyMode = z.infer<typeof PolicyModeSchema>;

export const TokenUsageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const StageMetadataSchema = z.object({
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number(),
  status: z.enum(['completed', 'failed', 'skipped']),

  // Inference identity — lets you explain why the same change got different verdicts
  model: z.string().optional(),
  provider: z.string().optional(),
  promptVersion: z.string().optional(),  // semver bumped when the prompt changes materially
  promptHash: z.string().optional(),     // SHA256 of the rendered system prompt
  inputHash: z.string().optional(),      // SHA256 of the serialised stage input

  tokenUsage: TokenUsageSchema.optional(),
  fromCache: z.boolean().optional(),     // true when this result came from verification cache
  error: z.string().optional(),
});
export type StageMetadata = z.infer<typeof StageMetadataSchema>;
