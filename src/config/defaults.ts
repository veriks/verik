export const DEFAULT_CONFIG = {
  version: 1 as const,
  provider: 'anthropic',
  models: {
    scout: 'configured-through-environment',
    reviewer: 'configured-through-environment',
    judge: 'configured-through-environment',
  },
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
