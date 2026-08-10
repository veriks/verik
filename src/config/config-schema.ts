import { z } from 'zod';

export const BuilderConfigSchema = z.object({
  enabled: z.boolean().default(true),
  timeoutMs: z.number().default(600_000),
  maxLogBytes: z.number().default(100_000),
  installDependencies: z.boolean().default(false),
  commands: z
    .array(
      z.object({
        name: z.string(),
        command: z.string(),
      }),
    )
    .optional(),
});

export const VerificationConfigSchema = z.object({
  includeUntrackedFiles: z.boolean().default(true),
  maxDiffBytes: z.number().default(500_000),
  maxFileBytes: z.number().default(150_000),
});

export const PrivacyConfigSchema = z.object({
  redactEnvironmentValues: z.boolean().default(true),
  excludePatterns: z
    .array(z.string())
    .default(['.env', '.env.*', '**/*.pem', '**/*.key', '**/credentials.*']),
});

export const ModelsConfigSchema = z.object({
  scout: z.string().default('claude-haiku-4-5'),
  reviewer: z.string().default('claude-sonnet-5'),
  judge: z.string().default('claude-opus-5'),
});

export const ProviderIdSchema = z.enum([
  'anthropic',
  'openai',
  'openrouter',
  'google',
  'mistral',
  'deepseek',
  'groq',
  'together',
  'fireworks',
  'huggingface',
  'ollama',
  'custom',
]);

/**
 * How much of the pipeline runs.
 *
 * `rules` needs no API key at all — the deterministic rules and the Builder are
 * plain code — so it stays useful for anyone who has not set one up. `full`
 * adds the Scout/Reviewer/Judge inference stages.
 */
export const VerificationModeSchema = z.enum(['rules', 'full']);

export const CrosscheckConfigSchema = z.object({
  version: z.literal(1),
  provider: ProviderIdSchema.default('anthropic'),
  /** Overrides the provider's default endpoint. Required for `custom`. */
  baseUrl: z.string().optional(),
  mode: VerificationModeSchema.default('full'),
  models: ModelsConfigSchema.default({}),
  builder: BuilderConfigSchema.default({}),
  verification: VerificationConfigSchema.default({}),
  privacy: PrivacyConfigSchema.default({}),
  inferenceTimeoutMs: z.number().default(120_000), // 2 minutes per LLM call
  runsToKeep: z.number().default(100), // prune older runs automatically
});

export type CrosscheckConfig = z.infer<typeof CrosscheckConfigSchema>;

/**
 * Turning a rule off is a decision someone should be able to review.
 *
 * The reason is required and lives in a committed file, so "we disabled the
 * secret scanner" arrives as a line in a pull request rather than as silence.
 * `at` is stamped automatically to make an old, forgotten exemption visible.
 */
export const DisabledRuleSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1),
  at: z.string().optional(),
});

/**
 * Per-rule tuning.
 *
 * `severity` is the lever to reach for first: it keeps a finding in the report
 * while stopping it from blocking, so the information survives. `disabled` is
 * the escape hatch — and even then the rule still runs and the finding is
 * recorded as suppressed, so nothing a rule found can vanish without trace.
 */
export const RulePolicySchema = z
  .object({
    severity: z
      .record(z.string(), z.enum(['info', 'low', 'medium', 'high', 'critical']))
      .default({}),
    disabled: z.array(DisabledRuleSchema).default([]),
  })
  .default({ severity: {}, disabled: [] });

export type RulePolicy = z.infer<typeof RulePolicySchema>;
export type DisabledRule = z.infer<typeof DisabledRuleSchema>;

export const PolicyConfigSchema = z.object({
  version: z.literal(1),
  mode: z.enum(['shadow', 'advisory', 'blocking']).default('advisory'),
  blockAtSeverity: z.enum(['info', 'low', 'medium', 'high', 'critical']).default('high'),
  minimumBlockingConfidence: z.number().min(0).max(1).default(0.8),
  requireBuilderSuccess: z.boolean().default(false),
  allowOverride: z.boolean().default(true),
  rules: RulePolicySchema,
});

export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;
