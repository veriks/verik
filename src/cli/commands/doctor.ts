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

async function check(
  label: string,
  fn: () => Promise<'ok' | 'warn' | { fail: string } | { warn: string }>,
): Promise<CheckResult> {
  try {
    const result = await fn();
    if (result === 'ok') return { label, status: 'ok' };
    if (result === 'warn') return { label, status: 'warn' };
    if (typeof result === 'object' && 'fail' in result)
      return { label, status: 'fail', detail: result.fail };
    if (typeof result === 'object' && 'warn' in result)
      return { label, status: 'warn', detail: result.warn };
    return { label, status: 'ok' };
  } catch (e) {
    return { label, status: 'fail', detail: String(e) };
  }
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
        process.exit(1);
      }

      const results: CheckResult[] = [];

      // 1. Git repo
      results.push(await check('Git repository detected', async () => 'ok'));

      // 2. .verik directory
      results.push(
        await check('.verik/ directory exists', async () => {
          try {
            await access(join(repoRoot, '.verik'));
            return 'ok';
          } catch {
            return { warn: 'run `verik init` to create it' };
          }
        }),
      );

      // 3. Config parses
      results.push(
        await check('config.json is valid', async () => {
          try {
            await loadConfig(repoRoot);
            return 'ok';
          } catch (e) {
            return { fail: String(e) };
          }
        }),
      );

      // 4. Policy parses
      results.push(
        await check('policy.json is valid', async () => {
          try {
            await loadPolicy(repoRoot);
            return 'ok';
          } catch (e) {
            return { fail: String(e) };
          }
        }),
      );

      // 5. API key present.
      //
      // Which variable that is depends on the configured provider. This used to
      // read ANTHROPIC_API_KEY unconditionally, so doctor told anyone on
      // OpenAI, Gemini or a local runtime that their key was missing when it
      // was not — from the one command whose job is diagnosing exactly that.
      const providerId = await loadConfig(repoRoot)
        .then((c) => c.provider)
        .catch(() => 'anthropic' as const);
      // `provider` is enum-validated on load, so the spec always exists — no
      // fallback, and therefore no place for an Anthropic assumption to hide.
      const spec: ProviderSpec = PROVIDERS[providerId as ProviderId];
      const keyVar = spec.apiKeyEnv;
      const apiKey = resolveApiKey(spec);
      results.push(
        await check(`${keyVar} is set`, async () => {
          if (apiKey || spec.keyOptional) return 'ok';
          return {
            fail: `Set ${keyVar} to enable AI verification stages (provider: ${providerId})`,
          };
        }),
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
          await check('API key is accepted by Anthropic', async () => {
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
                  fail: 'API key is invalid or expired — generate a new key at console.anthropic.com',
                };
              }
              if (e instanceof Anthropic.PermissionDeniedError) {
                return { fail: 'API key does not have permission to use this model' };
              }
              return { warn: `Could not reach Anthropic API: ${String(e)}` };
            }
          }),
        );
      } else if (apiKey && spec.baseUrl) {
        // Every other provider speaks OpenAI-compatible HTTP, where GET /models
        // both proves the key and lists what it can reach — one free request
        // instead of a billed completion per stage.
        const base = cfg?.baseUrl ?? spec.baseUrl;
        const available: string[] = [];

        results.push(
          await check(`API key is accepted by ${spec.label}`, async () => {
            try {
              const res = await fetch(`${base}/models`, {
                headers: { Authorization: `Bearer ${apiKey}` },
              });
              if (res.status === 401 || res.status === 403) {
                return { fail: `API key rejected — generate a new one at ${spec.docs}` };
              }
              if (!res.ok) return { warn: `${spec.label} returned HTTP ${res.status}` };
              const body = (await res.json()) as { data?: Array<{ id?: string }> };
              available.push(...(body.data ?? []).map((m) => m.id ?? '').filter(Boolean));
              return 'ok';
            } catch (e) {
              return { warn: `Could not reach ${spec.label}: ${String(e)}` };
            }
          }),
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
              await check(`Model for ${stage} (${model}) is listed`, async () =>
                listed.includes(model)
                  ? 'ok'
                  : {
                      warn: `"${model}" is not in ${spec.label}'s model list — it may still work, or set VERIK_MODEL_${stage.toUpperCase()}`,
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
        process.exit(failed.length > 0 ? 1 : 0);
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
        process.exit(1);
      } else {
        console.log(warn(`${warned.length} warning(s).`));
      }
    });
}
