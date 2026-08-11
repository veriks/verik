import { block } from '../output/theme.js';
import { formatError } from '../../shared/format-error.js';
import { Command } from 'commander';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { VerikError } from '../../shared/errors.js';
import { DEFAULT_CONFIG, DEFAULT_POLICY, DEFAULT_MODELS } from '../../config/defaults.js';
import { getOrCreateFingerprint } from '../../core/repository/repo-fingerprint.js';
import {
  PROVIDERS,
  PROVIDER_IDS,
  resolveApiKey,
  type ProviderId,
} from '../../inference/providers.js';
import { PromptCancelled } from '../output/keypress.js';
import { ask, checklist, isInteractive, reveal, select, stepHeader } from '../output/prompt.js';
import { detectProject } from '../../stages/builder/project-detector.js';
import { planCommands } from '../../stages/builder/command-planner.js';
import { banner, brand, card, mark, muted, pass, section, subtle, warn } from '../output/theme.js';

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
  policyMode: 'shadow' | 'advisory' | 'blocking';
  installHook: boolean;
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
/**
 * Starting models for a provider.
 *
 * DEFAULT_MODELS is Anthropic-only, so using it for every provider wrote
 * `claude-opus-5` into an OpenAI config and every stage 404'd on the first real
 * request. Each provider now carries its own.
 */
function modelsFor(provider: ProviderId): StageModels {
  const d = PROVIDERS[provider]?.defaultModels;
  return d ? { ...d } : { ...DEFAULT_MODELS };
}

type PolicyMode = 'shadow' | 'advisory' | 'blocking';

function parsePolicy(value: string | undefined): PolicyMode | undefined {
  return value === 'shadow' || value === 'advisory' || value === 'blocking' ? value : undefined;
}

/**
 * What should happen when something is found.
 *
 * This was never asked. Everyone got `advisory`, which always exits 0, and then
 * had to discover `verik policy mode blocking` in the docs to make the tool do
 * anything. Blocking leads because a verifier that cannot stop a change is a
 * report, and advisory is one keypress away for anyone who wants to look before
 * they enforce.
 */
async function askPolicy(
  options: { policy?: string },
  step: number,
  total: number,
): Promise<PolicyMode> {
  const flag = parsePolicy(options.policy);
  if (flag) return flag;
  return select<PolicyMode>({
    header: stepHeader(mark(), step, total),
    question: 'What should happen when Verik finds something?',
    choices: [
      {
        value: 'blocking',
        label: 'Block it',
        hint: 'Exit 2 at high severity or above — fails the commit and fails CI',
      },
      {
        value: 'advisory',
        label: 'Just tell me',
        hint: 'Reports everything, always exits 0. Change later with `verik policy mode`',
      },
      {
        value: 'shadow',
        label: 'Record quietly',
        hint: 'Writes a verdict to the run record and says nothing',
      },
    ],
  });
}

/** Verification you have to remember is verification that does not happen. */
async function askHook(options: { hook?: boolean }, step: number, total: number): Promise<boolean> {
  if (options.hook) return true;
  return select<boolean>({
    header: stepHeader(mark(), step, total),
    question: 'Check every commit automatically?',
    choices: [
      {
        value: true,
        label: 'Yes, install the git hook',
        hint: 'Runs the deterministic rules before each commit. Silent when clean',
      },
      {
        value: false,
        label: 'Not now',
        hint: 'Run `verik verify` yourself, or `verik hook install` later',
      },
    ],
  });
}

export function buildInitCommand(): Command {
  return new Command('init')
    .description('Set up Verik in the current repository')
    .option('-y, --yes', 'Accept defaults without prompting (for CI and scripts)')
    .option('--provider <id>', 'Inference provider (skips the prompt)')
    .option('--mode <mode>', 'rules | full')
    .option('--policy <mode>', 'shadow | advisory | blocking')
    .option('--hook', 'Install the pre-commit hook without asking')
    .action(
      async (options: {
        yes?: boolean;
        provider?: string;
        mode?: string;
        policy?: string;
        hook?: boolean;
      }) => {
        try {
          const info = await getRepositoryInfo(process.cwd());
          const ccDir = join(info.root, '.verik');
          const interactive = isInteractive() && !options.yes;

          if (interactive) console.log(banner());
          // Printed even under --yes: what was detected is information, and a CI
          // log showing "no build commands found" explains a later empty Builder
          // stage far better than silence does.
          await printDetected(info.root, info.branch, info.isDirty);

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
          // The chosen mode, not the default. Everyone silently landed in
          // advisory before this, then found their first BLOCK verdict exited 0
          // and had no way to tell whether that was a bug.
          const policy = { ...DEFAULT_POLICY, mode: setup.policyMode };
          await writeFile(join(ccDir, 'policy.json'), JSON.stringify(policy, null, 2), 'utf8');
          // objects/ and checkpoint.json are local baseline state — meaningless
          // in someone else's clone and noisy in a diff.
          await writeFile(
            join(ccDir, '.gitignore'),
            'runs/\ncache/\nobjects/\ncheckpoint.json\n',
            'utf8',
          );

          // Create a stable repo fingerprint immediately so memory is scoped
          // correctly from the very first run, not only after the first LLM call.
          const fingerprint = await getOrCreateFingerprint(info.root, info.remote);

          console.log(`\n  ${section('written')}`);
          await reveal(
            checklist([
              { label: 'config', detail: '.verik/config.json' },
              { label: 'policy', detail: `.verik/policy.json · ${setup.policyMode}` },
              { label: 'repo id', detail: fingerprint.repoId },
            ]),
          );

          if (setup.installHook) {
            const { installHook } = await import('../../core/hooks/git-hooks.js');
            const result = await installHook(info.root, { mode: setup.mode });
            console.log(
              checklist([
                {
                  label: 'hook',
                  detail: `${relative(info.root, result.target.path) || result.target.path}${
                    result.preservedForeignContent ? ' · existing hook preserved' : ''
                  }`,
                },
              ]).join('\n'),
            );
          }

          await printSummary(setup);
        } catch (err) {
          if (err instanceof PromptCancelled) {
            console.log(subtle('\n  Cancelled. Nothing was written.\n'));
            process.exit(130);
          }
          if (err instanceof VerikError) {
            console.error('Error:', err.message);
            process.exit(err.exitCode);
          }
          console.error(`${block('✕')} ${formatError(err)}`);
          process.exit(1);
        }
      },
    );
}

/**
 * Reports what was actually determined about this repository.
 *
 * This is the same detection the Builder performs at run time, so it doubles as
 * a preview: the commands listed here are literally the ones a run would
 * execute. That makes it worth reading rather than decoration — and if it says
 * "no build commands found", that is a genuine finding the user should see now
 * rather than discover on their first run.
 */
async function printDetected(root: string, branch: string, dirty: boolean): Promise<void> {
  const project = detectProject(root);
  const planned = planCommands(project, []);

  const stack = [project.projectTypes.join(', '), project.packageManager]
    .filter(Boolean)
    .join(' · ');

  const withKey = PROVIDER_IDS.map((id) => PROVIDERS[id]).find(
    (spec) => !spec.keyOptional && resolveApiKey(spec),
  );

  console.log(`  ${section('detected')}`);
  await reveal(
    checklist([
      { label: 'branch', detail: `${branch}${dirty ? subtle(' · uncommitted') : ''}` },
      {
        label: 'project',
        detail: stack || 'generic',
        state: project.projectTypes.includes('generic') ? 'none' : 'ok',
      },
      {
        label: 'commands',
        detail: planned.length
          ? planned.map((p) => p.command).join(' · ')
          : 'none found — the Builder stage will be skipped',
        state: planned.length ? 'ok' : 'none',
      },
      {
        label: 'api key',
        detail: withKey ? `${withKey.apiKeyEnv} detected` : 'none in environment',
        state: withKey ? 'ok' : 'none',
      },
    ]),
  );
}

async function collectSetup(
  options: { provider?: string; mode?: string; policy?: string; hook?: boolean },
  interactive: boolean,
): Promise<Setup> {
  const flagMode = options.mode === 'rules' || options.mode === 'full' ? options.mode : undefined;
  const flagProvider =
    options.provider && options.provider in PROVIDERS
      ? (options.provider as ProviderId)
      : undefined;

  if (!interactive || (flagMode && (flagMode === 'rules' || flagProvider))) {
    const provider = flagProvider ?? 'anthropic';
    return {
      mode: flagMode ?? 'full',
      provider,
      models: modelsFor(provider),
      // --yes is for CI and scripts: never touch the user's git hooks, and
      // never turn on a gate they did not ask for.
      policyMode: parsePolicy(options.policy) ?? DEFAULT_POLICY.mode,
      installHook: Boolean(options.hook),
    };
  }

  // Rules mode asks one question; full asks two. Showing "of 2" and then
  // stopping at 1 would read as a bug, so the total is decided after the first
  // answer and only rendered from step 2 onwards.
  const mode =
    flagMode ??
    (await select<Mode>({
      header: stepHeader(mark(), 1, 2),
      question: 'How much should Verik do?',
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
    const policyMode = await askPolicy(options, 2, 3);
    const installHook = await askHook(options, 3, 3);
    return {
      mode,
      provider: 'anthropic',
      models: { ...DEFAULT_MODELS },
      policyMode,
      installHook,
    };
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

  // Ids differ per host and change often, so the prompt stays — but it is
  // prefilled with the provider's own default rather than left empty. Pressing
  // enter used to fall back to Anthropic ids, which cannot work anywhere else.
  let models: StageModels = modelsFor(provider);
  if (provider !== 'anthropic') {
    const suggested = models.reviewer;
    const model = await ask(
      'Model id',
      suggested,
      spec.exampleModels ?? 'Applied to all three stages. Enter keeps the tiered defaults.',
    );
    // Only collapse the three stages onto one model if a different id was
    // actually typed. Accepting the suggestion used to set all three to the
    // Reviewer's model, which put the expensive one on Scout — the stage that
    // runs on every diff and is meant to be the cheap one.
    if (model && model !== suggested) models = { scout: model, reviewer: model, judge: model };
  }

  const policyMode = await askPolicy(options, 3, 4);
  const installHook = await askHook(options, 4, 4);
  return { mode, provider, baseUrl, models, policyMode, installHook };
}

async function printSummary(setup: Setup): Promise<void> {
  const spec = PROVIDERS[setup.provider];
  const hasKey = Boolean(resolveApiKey(spec));
  const ready = setup.mode === 'rules' || hasKey || spec.keyOptional;

  // The settings, not a sentence about them. The answered questions used to be
  // left on screen as loose ✓ lines that looked identical to the detection
  // checklist — three different kinds of thing rendered the same way. They
  // collapse in here instead, where they read as configuration.
  const rows: Array<[string, string]> = [
    ['mode', setup.mode === 'rules' ? 'rules only' : 'full pipeline'],
  ];

  if (setup.mode === 'rules') {
    rows.push(['runs', 'deterministic rules · your build, test and lint']);
    rows.push(['network', pass('none — nothing leaves this machine')]);
  } else {
    rows.push(['provider', spec.label]);
    rows.push([
      'models',
      setup.models.scout === setup.models.judge
        ? setup.models.scout
        : `${setup.models.scout} · ${setup.models.reviewer} · ${setup.models.judge}`,
    ]);
    rows.push([
      'api key',
      hasKey ? pass(`${spec.apiKeyEnv} set`) : warn(`${spec.apiKeyEnv} not set`),
    ]);
  }

  console.log();
  await reveal(card('READY', rows, ready ? pass : warn), 30);

  if (setup.mode === 'full' && !hasKey && !spec.keyOptional) {
    console.log(`\n  ${warn('!')} ${subtle(`export ${spec.apiKeyEnv}=...`)}`);
    console.log(`    ${subtle(spec.docs)}`);
  }

  console.log(`\n  ${section('try')}`);
  await reveal(
    [
      `  ${brand('verik verify')}${muted('          check your uncommitted changes')}`,
      `  ${brand('verik run -- <cmd>')}${muted('    wrap a coding agent')}`,
      `  ${brand('verik demo')}${muted('            see a full fake run')}`,
    ],
    40,
  );
  console.log();
}
