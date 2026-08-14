import { Command } from 'commander';
import { block, pass, warn } from '../output/theme.js';
import Anthropic from '@anthropic-ai/sdk';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import {
  PROVIDERS,
  resolveApiKey,
  type ProviderId,
  type ProviderSpec,
} from '../../inference/providers.js';
import { loadConfig, loadPolicy } from '../../config/config-loader.js';
import { validateBuilderCommands } from '../../stages/builder/command-allowlist.js';
import { join } from 'node:path';
import { access } from 'node:fs/promises';

const ok = (s: string) => `${pass('✓')} ${s}`;
const err = (s: string) => `${block('✕')} ${s}`;
const wrn = (s: string) => `${warn('~')} ${s}`;

interface CheckResult {
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail?: string;
}

/**
 * A label per outcome, because one label cannot describe both.
 *
 * Every label used to be a single string asserting the healthy state, printed
 * whatever the result was. So a machine with no `.verik` directory read
 * `~ .verik/ directory exists — run verik init to create it`, which says the
 * directory both does and does not exist, and a machine with no key read
 * `✕ ANTHROPIC_API_KEY is set`. The symbol and the sentence contradicted each
 * other on exactly the runs where a user most needs to trust the output.
 */
type Labels = string | { ok: string; warn?: string; fail?: string };

const labelFor = (labels: Labels, status: CheckResult['status']): string => {
  if (typeof labels === 'string') return labels;
  if (status === 'ok') return labels.ok;
  return (status === 'warn' ? labels.warn : labels.fail) ?? labels.ok;
};

async function check(
  labels: Labels,
  fn: () => Promise<'ok' | 'warn' | { fail: string } | { warn: string }>,
): Promise<CheckResult> {
  const done = (status: CheckResult['status'], detail?: string): CheckResult => ({
    label: labelFor(labels, status),
    status,
    ...(detail === undefined ? {} : { detail }),
  });
  try {
    const result = await fn();
    if (result === 'ok') return done('ok');
    if (result === 'warn') return done('warn');
    if (typeof result === 'object' && 'fail' in result) return done('fail', result.fail);
    if (typeof result === 'object' && 'warn' in result) return done('warn', result.warn);
    return done('ok');
  } catch (e) {
    return done('fail', String(e));
  }
}

/**
 * Which provider to diagnose when no config file has been written yet.
 *
 * Falling straight back to Anthropic meant a fresh checkout by someone holding
 * an OpenAI key was told `ANTHROPIC_API_KEY` was missing — true, and useless.
 * The key that is actually present is far better evidence of intent than the
 * first entry in an enum.
 */
function detectProviderFromEnv(): ProviderId | undefined {
  for (const id of Object.keys(PROVIDERS) as ProviderId[]) {
    const spec = PROVIDERS[id];
    // Local runtimes accept any key, so their env var proves nothing.
    if (spec.keyOptional) continue;
    if (process.env[spec.apiKeyEnv]) return id;
  }
  return undefined;
}

export function buildDoctorCommand(): Command {
  return new Command('doctor')
    .description('Validate Verik configuration and connectivity before running')
    .option('--json', 'Machine-readable output')
    .action(async (options: { json?: boolean }) => {
      let repoRoot: string;
      try {
        const info = await getRepositoryInfo(process.cwd());
        repoRoot = info.root;
      } catch {
        if (!options.json) console.error(err('Not a git repository — verik requires git.'));
        else console.log(JSON.stringify({ ok: false, error: 'not-a-git-repo' }));
        process.exitCode = 1;
        return;
      }

      const results: CheckResult[] = [];

      // 1. Git repo
      results.push(await check('Git repository detected', async () => 'ok'));

      const exists = (...parts: string[]) =>
        access(join(repoRoot, ...parts)).then(
          () => true,
          () => false,
        );
      const hasVerikDir = await exists('.verik');
      const hasConfigFile = await exists('.verik', 'config.json');
      const hasPolicyFile = await exists('.verik', 'policy.json');

      // 2. .verik directory
      results.push(
        await check(
          { ok: '.verik/ directory present', warn: '.verik/ not initialised' },
          async () =>
            hasVerikDir
              ? 'ok'
              : {
                  warn:
                    'run `verik init` to configure providers and policy; ' +
                    'deterministic rules run without it',
                },
        ),
      );

      // 3 and 4. Config and policy parse.
      //
      // `loadConfig` and `loadPolicy` fall back to built-in defaults when the
      // files are absent, so both used to report `✓ config.json is valid` in a
      // repository that had no config.json — naming a file that is not there
      // and calling it valid. The check is still worth running (the defaults
      // must load), but the label has to say which of the two it read.
      results.push(
        await check(
          hasConfigFile ? 'config.json is valid' : 'Configuration valid (built-in defaults)',
          async () => {
            try {
              await loadConfig(repoRoot);
              return 'ok';
            } catch (e) {
              return { fail: String(e) };
            }
          },
        ),
      );

      results.push(
        await check(
          hasPolicyFile ? 'policy.json is valid' : 'Policy valid (built-in defaults)',
          async () => {
            try {
              await loadPolicy(repoRoot);
              return 'ok';
            } catch (e) {
              return { fail: String(e) };
            }
          },
        ),
      );

      // 5. API key present.
      //
      // Which variable that is depends on the configured provider. This used to
      // read ANTHROPIC_API_KEY unconditionally, so doctor told anyone on
      // OpenAI, Gemini or a local runtime that their key was missing when it
      // was not — from the one command whose job is diagnosing exactly that.
      const configuredProvider = hasConfigFile
        ? await loadConfig(repoRoot)
            .then((c) => c.provider)
            .catch(() => undefined)
        : undefined;
      // Configured wins; otherwise believe whichever key is actually exported.
      const providerId = configuredProvider ?? detectProviderFromEnv() ?? 'anthropic';
      // `provider` is enum-validated on load, so the spec always exists — no
      // fallback, and therefore no place for an Anthropic assumption to hide.
      const spec: ProviderSpec = PROVIDERS[providerId as ProviderId];
      const keyVar = spec.apiKeyEnv;
      const apiKey = resolveApiKey(spec);
      const source = configuredProvider
        ? ''
        : detectProviderFromEnv()
          ? ' (detected from environment)'
          : ' (default)';
      results.push(
        await check(
          {
            ok: `${keyVar} is set (provider: ${spec.label}${source})`,
            warn: `${keyVar} is not set (provider: ${spec.label}${source})`,
          },
          async () => {
            if (apiKey || spec.keyOptional) return 'ok';
            // Not a failure. Deterministic rules are the whole product without
            // a key, and `verik verify --mode rules` is the documented offline
            // path — so exiting 1 here told every new user their healthy
            // install was broken before they had run anything.
            return {
              warn: 'the AI stages are skipped without it; `verik verify --mode rules` needs no key',
            };
          },
        ),
      );

      // 6 and 7. Key and models, asked of the provider actually configured.
      //
      // These used to build an Anthropic client and request claude-haiku-4-5
      // whatever the config said, so an OpenAI user with a perfectly good key
      // saw "API key is invalid or expired — generate a new key at
      // console.anthropic.com" and three rejected models. Diagnostics that
      // confidently blame the wrong thing are worse than none.
      const cfg = await loadConfig(repoRoot).catch(() => undefined);

      if (apiKey && providerId === 'anthropic') {
        results.push(
          await check(
            {
              ok: 'API key is accepted by Anthropic',
              fail: 'API key is rejected by Anthropic',
              warn: 'Could not reach the Anthropic API',
            },
            async () => {
              try {
                const client = new Anthropic({ apiKey, maxRetries: 0 });
                await client.messages.create({
                  model: 'claude-haiku-4-5',
                  max_tokens: 1,
                  messages: [{ role: 'user', content: 'ping' }],
                });
                return 'ok';
              } catch (e) {
                if (e instanceof Anthropic.AuthenticationError) {
                  return {
                    fail: 'it is invalid or expired — generate a new key at console.anthropic.com',
                  };
                }
                if (e instanceof Anthropic.PermissionDeniedError) {
                  return { fail: 'it does not have permission to use this model' };
                }
                return { warn: String(e) };
              }
            },
          ),
        );
      } else if (apiKey && spec.baseUrl) {
        // Every other provider speaks OpenAI-compatible HTTP, where GET /models
        // both proves the key and lists what it can reach — one free request
        // instead of a billed completion per stage.
        const base = cfg?.baseUrl ?? spec.baseUrl;
        const available: string[] = [];

        results.push(
          await check(
            {
              ok: `API key is accepted by ${spec.label}`,
              fail: `API key is rejected by ${spec.label}`,
              warn: `Could not reach ${spec.label}`,
            },
            async () => {
              try {
                const res = await fetch(`${base}/models`, {
                  headers: { Authorization: `Bearer ${apiKey}` },
                });
                if (res.status === 401 || res.status === 403) {
                  return { fail: `generate a new one at ${spec.docs}` };
                }
                if (!res.ok) return { warn: `it returned HTTP ${res.status}` };
                const body = (await res.json()) as { data?: Array<{ id?: string }> };
                available.push(...(body.data ?? []).map((m) => m.id ?? '').filter(Boolean));
                return 'ok';
              } catch (e) {
                return { warn: String(e) };
              }
            },
          ),
        );

        // Absence is a warning, not a failure: plenty of gateways serve models
        // they do not enumerate.
        if (cfg && available.length > 0) {
          const listed = available;
          for (const [stage, model] of [
            ['scout', cfg.models.scout],
            ['reviewer', cfg.models.reviewer],
            ['judge', cfg.models.judge],
          ] as [string, string][]) {
            results.push(
              await check(
                {
                  ok: `Model for ${stage} (${model}) is listed`,
                  warn: `Model for ${stage} (${model}) is not listed`,
                },
                async () =>
                  listed.includes(model)
                    ? 'ok'
                    : {
                        warn: `it may still work; override with VERIK_MODEL_${stage.toUpperCase()}`,
                      },
              ),
            );
          }
        }
      }

      // 8. Builder commands are safe
      results.push(
        await check('Builder extra commands pass allowlist', async () => {
          try {
            const config = await loadConfig(repoRoot);
            if (!config.builder.commands?.length) return 'ok';
            // loadConfig already validates, but we want a specific error message here.
            validateBuilderCommands(config.builder.commands);
            return 'ok';
          } catch (e) {
            return { fail: String(e).replace('ConfigError: ', '') };
          }
        }),
      );

      // Print results
      const failed = results.filter((r) => r.status === 'fail');
      const warned = results.filter((r) => r.status === 'warn');
      const passed = results.filter((r) => r.status === 'ok');

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              ok: failed.length === 0,
              passed: passed.length,
              warned: warned.length,
              failed: failed.length,
              checks: results,
            },
            null,
            2,
          ),
        );
        process.exitCode = failed.length > 0 ? 1 : 0;
        return;
      }

      console.log('');
      for (const r of results) {
        if (r.status === 'ok') console.log(ok(r.label));
        if (r.status === 'warn') console.log(wrn(`${r.label}${r.detail ? ` — ${r.detail}` : ''}`));
        if (r.status === 'fail') console.log(err(`${r.label}${r.detail ? ` — ${r.detail}` : ''}`));
      }

      console.log('');
      if (failed.length === 0 && warned.length === 0) {
        console.log(pass('Everything looks good.'));
      } else if (failed.length > 0) {
        console.log(block(`${failed.length} check(s) failed.`));
        // doctor reaches the provider over HTTP, so this cannot be
        // process.exit() — forcing exit while the handle is closing trips a
        // libuv assertion on Windows and returns 127 instead of 1.
        process.exitCode = 1;
      } else {
        console.log(warn(`${warned.length} warning(s).`));
      }
    });
}
