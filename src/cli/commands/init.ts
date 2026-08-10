import { Command } from 'commander';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { CrosscheckError } from '../../shared/errors.js';
import { DEFAULT_CONFIG, DEFAULT_POLICY, DEFAULT_MODELS } from '../../config/defaults.js';
import { getOrCreateFingerprint } from '../../core/repository/repo-fingerprint.js';
import { PROVIDERS, resolveApiKey, type ProviderId } from '../../inference/providers.js';
import { ask, isInteractive, select } from '../output/prompt.js';
import { banner, brand, kv, muted, pass, section, subtle, warn } from '../output/theme.js';

type Mode = 'rules' | 'full';
interface StageModels {
  scout: string;
  reviewer: string;
  judge: string;
}

/**
 * Onboarding.
 *
 * The point of asking rather than assuming: the deterministic rules and the
 * Builder need no API key at all, so a user without one still has a working
 * product. Previously that user got a config demanding a key, then a run where
 * every stage failed — the worst possible first impression of something that
 * does in fact work.
 */
export function buildInitCommand(): Command {
  return new Command('init')
    .description('Initialize Crosscheck in the current repository')
    .option('-y, --yes', 'Accept defaults without prompting (for CI and scripts)')
    .option('--provider <id>', 'Inference provider (skips the prompt)')
    .option('--mode <mode>', 'rules | full')
    .action(async (options: { yes?: boolean; provider?: string; mode?: string }) => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        const ccDir = join(info.root, '.crosscheck');

        const interactive = isInteractive() && !options.yes;
        if (interactive) console.log(banner());

        const mode = await chooseMode(options, interactive);
        const { provider, baseUrl, models } = await chooseProvider(options, mode, interactive);

        await mkdir(join(ccDir, 'runs'), { recursive: true });
        await mkdir(join(ccDir, 'cache'), { recursive: true });

        const config = {
          ...DEFAULT_CONFIG,
          provider,
          mode,
          ...(baseUrl ? { baseUrl } : {}),
          models,
        };

        const configPath = join(ccDir, 'config.json');
        const policyPath = join(ccDir, 'policy.json');
        await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
        await writeFile(policyPath, JSON.stringify(DEFAULT_POLICY, null, 2), 'utf8');
        await writeFile(join(ccDir, '.gitignore'), 'runs/\ncache/\n', 'utf8');

        // Create a stable repo fingerprint immediately so memory is scoped
        // correctly from the very first run, not only after the first LLM call.
        const fingerprint = await getOrCreateFingerprint(info.root, info.remote);

        console.log(`\n${pass('✓')} Crosscheck initialized.\n`);
        console.log(kv('config', configPath));
        console.log(kv('policy', policyPath));
        console.log(kv('repo id', fingerprint.repoId));
        console.log(
          kv('mode', mode === 'rules' ? 'rules only (no API key needed)' : 'full pipeline'),
        );
        console.log(kv('provider', PROVIDERS[provider].label));

        printNextSteps(mode, provider);
      } catch (err) {
        if (err instanceof CrosscheckError) {
          console.error('Error:', err.message);
          process.exit(err.exitCode);
        }
        console.error('Error:', String(err));
        process.exit(1);
      }
    });
}

async function chooseMode(options: { mode?: string }, interactive: boolean): Promise<Mode> {
  if (options.mode === 'rules' || options.mode === 'full') return options.mode;
  if (!interactive) return 'full';

  return select<Mode>(
    `${section('how much should crosscheck do?')}`,
    [
      {
        value: 'full',
        label: 'Full pipeline — Scout, Builder, Reviewer, Judge',
        hint: 'Needs an API key. Roughly $0.15–0.60 per run depending on diff size and models.',
      },
      {
        value: 'rules',
        label: 'Rules only — deterministic checks and your build/test/lint',
        hint: 'No API key, no network, nothing leaves your machine. Free forever.',
      },
    ],
    0,
  );
}

async function chooseProvider(
  options: { provider?: string },
  mode: Mode,
  interactive: boolean,
): Promise<{ provider: ProviderId; baseUrl?: string; models: StageModels }> {
  const fallback: { provider: ProviderId; models: StageModels } = {
    provider: 'anthropic',
    models: { ...DEFAULT_MODELS },
  };

  if (options.provider && options.provider in PROVIDERS) {
    return { ...fallback, provider: options.provider as ProviderId };
  }
  // Rules mode makes no inference calls, so the provider is irrelevant until
  // the user switches to full — don't make them answer a question that has no
  // effect on anything they are about to do.
  if (mode === 'rules' || !interactive) return fallback;

  const provider = await select<ProviderId>(
    `${section('which provider?')}`,
    [
      {
        value: 'anthropic',
        label: 'Anthropic',
        hint: 'Claude. Tiered defaults already configured.',
      },
      { value: 'openai', label: 'OpenAI' },
      { value: 'openrouter', label: 'OpenRouter', hint: 'One key, many models from many vendors.' },
      { value: 'google', label: 'Google (Gemini)' },
      {
        value: 'ollama',
        label: 'Ollama (local)',
        hint: 'Runs on your machine. No key, no data leaves it.',
      },
      {
        value: 'custom',
        label: 'Something else',
        hint: 'Any OpenAI-compatible endpoint — Mistral, DeepSeek, Groq, Together, Fireworks, Hugging Face.',
      },
    ],
    0,
  );

  const spec = PROVIDERS[provider];
  let baseUrl: string | undefined;
  if (provider === 'custom') {
    baseUrl = await ask('  Base URL (OpenAI-compatible)', 'https://');
  }

  // Anthropic ships with verified tiered defaults; for anything else the model
  // ids differ per host and change often, so ask rather than guess — a wrong
  // default only surfaces as a confusing 404 on the first real run.
  let models: StageModels = { ...DEFAULT_MODELS };
  if (provider !== 'anthropic') {
    if (spec.exampleModels) console.log(subtle(`\n  ${spec.exampleModels}`));
    const one = await ask('  Model to use for all three stages', '');
    if (one) models = { scout: one, reviewer: one, judge: one };
  }

  return { provider, baseUrl, models };
}

function printNextSteps(mode: Mode, provider: ProviderId): void {
  const spec = PROVIDERS[provider];
  console.log(`\n${section('next')}`);

  if (mode === 'full') {
    const key = resolveApiKey(spec);
    if (key) {
      console.log(`  ${pass('✓')} ${spec.apiKeyEnv} is set`);
    } else if (!spec.keyOptional) {
      console.log(`  ${warn('!')} ${spec.apiKeyEnv} is not set — LLM stages will not run`);
      console.log(subtle(`    export ${spec.apiKeyEnv}=...   (${spec.docs})`));
    }
  } else {
    console.log(subtle('  Rules mode needs no key. Switch to the full pipeline any time with:'));
    console.log(`    ${brand('crosscheck init --mode full')}`);
  }

  console.log(
    `\n  ${brand('crosscheck verify')}${muted('               check your uncommitted changes')}`,
  );
  console.log(`  ${brand('crosscheck run -- <command>')}${muted('     wrap a coding agent')}`);
  console.log(`  ${brand('crosscheck demo')}${muted('                 see a full fake run')}\n`);
}
