import { CrosscheckConfigSchema, PolicyConfigSchema } from './config-schema.js';
import type { CrosscheckConfig, PolicyConfig } from './config-schema.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigError } from '../shared/errors.js';
import { validateBuilderCommands } from '../stages/builder/command-allowlist.js';

export const CROSSCHECK_DIR = '.crosscheck';

export async function loadConfig(repoRoot: string): Promise<CrosscheckConfig> {
  const configPath = join(repoRoot, CROSSCHECK_DIR, 'config.json');
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const result = CrosscheckConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new ConfigError(`Invalid config: ${result.error.message}`);
    }
    const config = applyEnvironmentOverrides(result.data);
    // Validate extra builder commands against the allowlist.
    // This runs at load time so `crosscheck run` fails fast with a clear message
    // rather than executing a malicious command string mid-verification.
    if (config.builder.commands?.length) {
      validateBuilderCommands(config.builder.commands);
    }
    return config;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return applyEnvironmentOverrides(CrosscheckConfigSchema.parse({ version: 1 }));
    }
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(`Failed to read config: ${String(err)}`);
  }
}

export async function loadPolicy(repoRoot: string): Promise<PolicyConfig> {
  const policyPath = join(repoRoot, CROSSCHECK_DIR, 'policy.json');
  try {
    const raw = await readFile(policyPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const result = PolicyConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new ConfigError(`Invalid policy: ${result.error.message}`);
    }
    return result.data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return PolicyConfigSchema.parse({ version: 1 });
    }
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(`Failed to read policy: ${String(err)}`);
  }
}

function applyEnvironmentOverrides(config: CrosscheckConfig): CrosscheckConfig {
  const scout    = process.env['CROSSCHECK_MODEL_SCOUT']    ?? config.models.scout;
  const reviewer = process.env['CROSSCHECK_MODEL_REVIEWER'] ?? config.models.reviewer;
  const judge    = process.env['CROSSCHECK_MODEL_JUDGE']    ?? config.models.judge;
  return { ...config, models: { scout, reviewer, judge } };
}
