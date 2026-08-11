export class VerikError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly exitCode: number = 1,
  ) {
    super(message);
    this.name = 'VerikError';
  }
}

export class ConfigError extends VerikError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR', 4);
  }
}

export class RepositoryError extends VerikError {
  constructor(message: string) {
    super(message, 'REPOSITORY_ERROR', 1);
  }
}

export class CommandSpawnError extends VerikError {
  constructor(message: string) {
    super(message, 'COMMAND_SPAWN_ERROR', 5);
  }
}

export class StorageError extends VerikError {
  constructor(message: string) {
    super(message, 'STORAGE_ERROR', 1);
  }
}

export class ProviderError extends VerikError {
  constructor(message: string) {
    super(message, 'PROVIDER_ERROR', 1);
  }
}

export class PolicyDeniedError extends VerikError {
  constructor(message: string) {
    super(message, 'POLICY_DENIED', 2);
  }
}

export class VerificationInconclusiveError extends VerikError {
  constructor(message: string) {
    super(message, 'VERIFICATION_INCONCLUSIVE', 3);
  }
}
