import { z } from 'zod';

export const BuilderConfigSchema = z.object({
  enabled: z.boolean().default(true),
  timeoutMs: z.number().default(600_000),
  maxLogBytes: z.number().default(100_000),
  installDependencies: z.boolean().default(false),
  commands: z.array(z.object({
    name: z.string(),
    command: z.string(),
  })).optional(),
});

export const VerificationConfigSchema = z.object({
  includeUntrackedFiles: z.boolean().default(true),
  maxDiffBytes: z.number().default(500_000),
  maxFileBytes: z.number().default(150_000),
});

export const PrivacyConfigSchema = z.object({
  redactEnvironmentValues: z.boolean().default(true),
  excludePatterns: z.array(z.string()).default([
    '.env', '.env.*', '**/*.pem', '**/*.key', '**/credentials.*',
  ]),
});

export const ModelsConfigSchema = z.object({
  scout: z.string().default('configured-through-environment'),
  reviewer: z.string().default('configured-through-environment'),
  judge: z.string().default('configured-through-environment'),
});

export const CrosscheckConfigSchema = z.object({
  version: z.literal(1),
  provider: z.string().default('anthropic'),
  models: ModelsConfigSchema.default({}),
  builder: BuilderConfigSchema.default({}),
  verification: VerificationConfigSchema.default({}),
  privacy: PrivacyConfigSchema.default({}),
});

export type CrosscheckConfig = z.infer<typeof CrosscheckConfigSchema>;

export const PolicyConfigSchema = z.object({
  version: z.literal(1),
  mode: z.enum(['shadow', 'advisory', 'blocking']).default('advisory'),
  blockAtSeverity: z.enum(['info', 'low', 'medium', 'high', 'critical']).default('high'),
  minimumBlockingConfidence: z.number().min(0).max(1).default(0.8),
  requireBuilderSuccess: z.boolean().default(false),
  allowOverride: z.boolean().default(true),
});

export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;
