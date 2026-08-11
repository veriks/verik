import { VerikConfigSchema, PolicyConfigSchema, ModelsConfigSchema } from './config-schema.js';
import { PROVIDERS } from '../inference/providers.js';
import type { VerikConfig, PolicyConfig } from './config-schema.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigError } from '../shared/errors.js';
import { validateBuilderCommands } from '../stages/builder/command-allowlist.js';

export const VERIK_DIR = '.verik';

/** A provider's own default models, falling back to the schema's. */
function modelsForProvider(provider: string): VerikConfig['models'] {
  const spec = (PROVIDERS as Record<string, { defaultModels?: VerikConfig['models'] }>)[provider];
  return spec?.defaultModels ? { ...spec.defaultModels } : ModelsConfigSchema.parse({});
}

export async function loadConfig(repoRoot: string): Promise<VerikConfig> {
  const configPath = join(repoRoot, VERIK_DIR, 'config.json');
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const result = VerikConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new ConfigError(`Invalid config: ${result.error.message}`);
    }
    // The schema's model defaults are Anthropic ids, and zod cannot know the
    // provider. A config naming a different provider without a `models` block
    // therefore came back asking that provider for claude-opus-5. Checking the
    // raw JSON distinguishes "absent" from "deliberately set to a Claude id".
    const rawHasModels =
      typeof parsed === 'object' && parsed !== null && 'models' in (parsed as object);
    const withModels = rawHasModels
      ? result.data
      : { ...result.data, models: modelsForProvider(result.data.provider) };

    const config = applyEnvironmentOverrides(withModels);
    // Validate extra builder commands against the allowlist.
    // This runs at load time so `verik run` fails fast with a clear message
    // rather than executing a malicious command string mid-verification.
    if (config.builder.commands?.length) {
      validateBuilderCommands(config.builder.commands);
    }
    return config;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      const base = VerikConfigSchema.parse({ version: 1 });
      return applyEnvironmentOverrides({ ...base, models: modelsForProvider(base.provider) });
    }
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(`Failed to read config: ${String(err)}`);
  }
}

export async function loadPolicy(repoRoot: string): Promise<PolicyConfig> {
  const policyPath = join(repoRoot, VERIK_DIR, 'policy.json');
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

/**
 * Writes policy.json back.
 *
 * Validated before writing, so a bad edit fails here rather than at the start
 * of someone's next commit. Formatted with two-space indent and a trailing
 * newline because this file is committed and read in pull requests — a policy
 * change should produce a clean, minimal diff.
 */
export async function savePolicy(repoRoot: string, policy: PolicyConfig): Promise<void> {
  const result = PolicyConfigSchema.safeParse(policy);
  if (!result.success) {
    throw new ConfigError(`Refusing to write an invalid policy: ${result.error.message}`);
  }
  const policyPath = join(repoRoot, VERIK_DIR, 'policy.json');
  await mkdir(join(repoRoot, VERIK_DIR), { recursive: true });
  await writeFile(policyPath, `${JSON.stringify(result.data, null, 2)}\n`, 'utf8');
}

function applyEnvironmentOverrides(config: VerikConfig): VerikConfig {
  const scout = process.env['VERIK_MODEL_SCOUT'] ?? config.models.scout;
  const reviewer = process.env['VERIK_MODEL_REVIEWER'] ?? config.models.reviewer;
  const judge = process.env['VERIK_MODEL_JUDGE'] ?? config.models.judge;
  return { ...config, models: { scout, reviewer, judge } };
}
