import { Command } from 'commander';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { CrosscheckError } from '../../shared/errors.js';
import { DEFAULT_CONFIG, DEFAULT_POLICY, DEFAULT_MODELS } from '../../config/defaults.js';
import { getOrCreateFingerprint } from '../../core/repository/repo-fingerprint.js';
import { PROVIDERS, resolveApiKey, type ProviderId } from '../../inference/providers.js';
import { PromptCancelled } from '../output/keypress.js';
import { ask, isInteractive, select, stepHeader } from '../output/prompt.js';
import { banner, box, brand, mark, muted, pass, subtle, warn } from '../output/theme.js';

type Mode = 'rules' | 'full';

interface StageModels {
  scout: string;
  reviewer: string;
  judge: string;
}

interface Setup {
  mode: Mode;
  provider: ProviderId;
  baseUrl?: string;
  models: StageModels;
}

/**
 * Onboarding.
 *
 * Two principles drive the shape of this.
 *
 * First, `rules` mode is a real product, not a consolation prize: the
 * deterministic rules and the Builder are plain code and need no API key, so a
 * user without one still gets working verification. It is presented as a peer of
 * the full pipeline, not a fallback.
 *
 * Second, ask as little as possible. Anything detectable from the environment is
 * detected and shown as a badge rather than asked about, so the common path is
 * two keypresses.
 */
export function buildInitCommand(): Command {
  return new Command('init')
    .description('Set up Crosscheck in the current repository')
    .option('-y, --yes', 'Accept defaults without prompting (for CI and scripts)')
    .option('--provider <id>', 'Inference provider (skips the prompt)')
    .option('--mode <mode>', 'rules | full')
    .action(async (options: { yes?: boolean; provider?: string; mode?: string }) => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        const ccDir = join(info.root, '.crosscheck');
        const interactive = isInteractive() && !options.yes;

        if (interactive) console.log(banner());

        const setup = await collectSetup(options, interactive);

        await mkdir(join(ccDir, 'runs'), { recursive: true });
        await mkdir(join(ccDir, 'cache'), { recursive: true });

        const config = {
          ...DEFAULT_CONFIG,
          provider: setup.provider,
          mode: setup.mode,
          ...(setup.baseUrl ? { baseUrl: setup.baseUrl } : {}),
          models: setup.models,
        };

        await writeFile(join(ccDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
        await writeFile(
          join(ccDir, 'policy.json'),
          JSON.stringify(DEFAULT_POLICY, null, 2),
          'utf8',
        );
        await writeFile(join(ccDir, '.gitignore'), 'runs/\ncache/\n', 'utf8');

        // Create a stable repo fingerprint immediately so memory is scoped
        // correctly from the very first run, not only after the first LLM call.
        await getOrCreateFingerprint(info.root, info.remote);

        printSummary(setup);
      } catch (err) {
        if (err instanceof PromptCancelled) {
          console.log(subtle('\n  Cancelled. Nothing was written.\n'));
          process.exit(130);
        }
        if (err instanceof CrosscheckError) {
          console.error('Error:', err.message);
          process.exit(err.exitCode);
        }
        console.error('Error:', String(err));
        process.exit(1);
      }
    });
}

async function collectSetup(
  options: { provider?: string; mode?: string },
  interactive: boolean,
): Promise<Setup> {
  const flagMode = options.mode === 'rules' || options.mode === 'full' ? options.mode : undefined;
  const flagProvider =
    options.provider && options.provider in PROVIDERS
      ? (options.provider as ProviderId)
      : undefined;

  if (!interactive || (flagMode && (flagMode === 'rules' || flagProvider))) {
    return {
      mode: flagMode ?? 'full',
      provider: flagProvider ?? 'anthropic',
      models: { ...DEFAULT_MODELS },
    };
  }

  // Rules mode asks one question; full asks two. Showing "of 2" and then
  // stopping at 1 would read as a bug, so the total is decided after the first
  // answer and only rendered from step 2 onwards.
  const mode =
    flagMode ??
    (await select<Mode>({
      header: stepHeader(mark(), 1, 2),
      question: 'How much should Crosscheck do?',
      choices: [
        {
          value: 'full',
          label: 'Full pipeline',
          hint: 'Scout · Builder · Reviewer · Judge — needs an API key, roughly $0.15–0.60 a run',
        },
        {
          value: 'rules',
          label: 'Rules only',
          hint: 'Deterministic checks and your build/test/lint — no key, nothing leaves your machine',
        },
      ],
    }));

  if (mode === 'rules') {
    return { mode, provider: 'anthropic', models: { ...DEFAULT_MODELS } };
  }

  const provider =
    flagProvider ??
    (await select<ProviderId>({
      header: stepHeader(mark(), 2, 2),
      question: 'Which provider?',
      choices: (
        [
          ['anthropic', 'Anthropic', 'Claude — tiered defaults already configured'],
          ['openai', 'OpenAI', ''],
          ['openrouter', 'OpenRouter', 'One key, models from every vendor'],
          ['google', 'Google', 'Gemini'],
          ['ollama', 'Ollama', 'Local. No key, nothing leaves your machine'],
          [
            'custom',
            'Something else',
            'Any OpenAI-compatible endpoint — Mistral, DeepSeek, Groq, Together, Fireworks, Hugging Face',
          ],
        ] as const
      ).map(([value, label, hint]) => ({
        value: value as ProviderId,
        label,
        hint: hint || undefined,
        // Detected rather than asked: if the key is already exported, say so.
        badge: resolveApiKey(PROVIDERS[value as ProviderId]) ? 'key detected' : undefined,
      })),
    }));

  const spec = PROVIDERS[provider];
  const baseUrl =
    provider === 'custom'
      ? await ask('Base URL', 'https://', 'An OpenAI-compatible /chat/completions endpoint.')
      : undefined;

  // Anthropic ships verified tiered defaults. For anything else the ids differ
  // per host and change often, so ask rather than guess — a wrong default only
  // surfaces as a confusing 404 on the first real request.
  let models: StageModels = { ...DEFAULT_MODELS };
  if (provider !== 'anthropic') {
    const model = await ask('Model id', '', spec.exampleModels ?? 'Used for all three stages.');
    if (model) models = { scout: model, reviewer: model, judge: model };
  }

  return { mode, provider, baseUrl, models };
}

function printSummary(setup: Setup): void {
  const spec = PROVIDERS[setup.provider];
  const hasKey = Boolean(resolveApiKey(spec));

  const body =
    setup.mode === 'rules'
      ? 'Deterministic rules and your build, test and lint commands. No API key, no network.'
      : `Four stages via ${spec.label}. ${
          hasKey ? `${spec.apiKeyEnv} is set.` : `Set ${spec.apiKeyEnv} before your first run.`
        }`;

  console.log();
  for (const line of box('READY', body, hasKey || setup.mode === 'rules' ? pass : warn)) {
    console.log(line);
  }

  if (setup.mode === 'full' && !hasKey && !spec.keyOptional) {
    console.log(`\n  ${warn('!')} ${subtle(`export ${spec.apiKeyEnv}=...`)}`);
    console.log(`    ${subtle(spec.docs)}`);
  }

  console.log(
    `\n  ${brand('crosscheck verify')}${muted('             check your uncommitted changes')}`,
  );
  console.log(`  ${brand('crosscheck run -- <cmd>')}${muted('       wrap a coding agent')}`);
  console.log(`  ${brand('crosscheck demo')}${muted('               see a full fake run')}\n`);
}
