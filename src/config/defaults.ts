/**
 * Per-stage model defaults, tiered by how much capability each stage needs.
 *
 * Scout triages the diff (cheap), Reviewer does the analysis, Judge makes the
 * final call — the verdict is the product, so it gets the strongest model.
 *
 * Override per stage with VERIK_MODEL_{SCOUT,REVIEWER,JUDGE}, or by
 * setting `models` in .verik/config.json.
 */
export const DEFAULT_MODELS = {
  scout: 'claude-haiku-4-5',
  reviewer: 'claude-sonnet-5',
  judge: 'claude-opus-5',
} as const;

export const DEFAULT_CONFIG = {
  version: 1 as const,
  provider: 'anthropic',
  models: { ...DEFAULT_MODELS },
  builder: {
    enabled: true,
    timeoutMs: 600_000,
    maxLogBytes: 100_000,
    installDependencies: false,
  },
  verification: {
    includeUntrackedFiles: true,
    maxDiffBytes: 500_000,
    maxFileBytes: 150_000,
  },
  privacy: {
    redactEnvironmentValues: true,
    excludePatterns: ['.env', '.env.*', '**/*.pem', '**/*.key', '**/credentials.*'],
  },
  inferenceTimeoutMs: 120_000,
  runsToKeep: 100,
};

export const DEFAULT_POLICY = {
  version: 1 as const,
  mode: 'advisory' as const,
  blockAtSeverity: 'high' as const,
  minimumBlockingConfidence: 0.8,
  requireBuilderSuccess: false,
  allowOverride: true,
};
