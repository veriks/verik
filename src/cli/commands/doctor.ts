import { Command } from 'commander';
import chalk from 'chalk';
import Anthropic from '@anthropic-ai/sdk';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { loadConfig, loadPolicy } from '../../config/config-loader.js';
import { validateBuilderCommands } from '../../stages/builder/command-allowlist.js';
import { join } from 'node:path';
import { access } from 'node:fs/promises';

const c = () => process.stdout.isTTY && !process.env['NO_COLOR'];
const ok = (s: string) => (c() ? chalk.green('✓') + ' ' + s : '✓ ' + s);
const err = (s: string) => (c() ? chalk.red('✗') + ' ' + s : '✗ ' + s);
const wrn = (s: string) => (c() ? chalk.yellow('~') + ' ' + s : '~ ' + s);

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
    .description('Validate Crosscheck configuration and connectivity before running')
    .option('--json', 'Machine-readable output')
    .action(async (options: { json?: boolean }) => {
      let repoRoot: string;
      try {
        const info = await getRepositoryInfo(process.cwd());
        repoRoot = info.root;
      } catch {
        if (!options.json) console.error(err('Not a git repository — crosscheck requires git.'));
        else console.log(JSON.stringify({ ok: false, error: 'not-a-git-repo' }));
        process.exit(1);
      }

      const results: CheckResult[] = [];

      // 1. Git repo
      results.push(await check('Git repository detected', async () => 'ok'));

      // 2. .crosscheck directory
      results.push(
        await check('.crosscheck/ directory exists', async () => {
          try {
            await access(join(repoRoot, '.crosscheck'));
            return 'ok';
          } catch {
            return { warn: 'run `crosscheck init` to create it' };
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

      // 5. API key present
      const apiKey = process.env['ANTHROPIC_API_KEY'];
      results.push(
        await check('ANTHROPIC_API_KEY is set', async () => {
          if (apiKey) return 'ok';
          return { fail: 'Set ANTHROPIC_API_KEY to enable AI verification stages' };
        }),
      );

      // 6. API key valid (only if present)
      if (apiKey) {
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

        // 7. Model names resolve
        let config;
        try {
          config = await loadConfig(repoRoot);
        } catch {
          /* already caught above */
        }
        if (config) {
          const client = new Anthropic({ apiKey, maxRetries: 0 });
          for (const [stage, model] of [
            ['scout', config.models.scout],
            ['reviewer', config.models.reviewer],
            ['judge', config.models.judge],
          ] as [string, string][]) {
            if (model === 'configured-through-environment') continue;
            results.push(
              await check(`Model for ${stage} (${model}) is accessible`, async () => {
                try {
                  await client.messages.create({
                    model,
                    max_tokens: 1,
                    messages: [{ role: 'user', content: 'ping' }],
                  });
                  return 'ok';
                } catch (e) {
                  if (e instanceof Anthropic.NotFoundError) {
                    return {
                      fail: `Model "${model}" not found — check CROSSCHECK_MODEL_${stage.toUpperCase()} or config.json`,
                    };
                  }
                  if (e instanceof Anthropic.AuthenticationError) {
                    return { fail: 'API key rejected' };
                  }
                  return { warn: `Could not verify model: ${String(e)}` };
                }
              }),
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
        console.log(c() ? chalk.green('Everything looks good.') : 'Everything looks good.');
      } else if (failed.length > 0) {
        console.log(
          c()
            ? chalk.red(`${failed.length} check(s) failed.`)
            : `${failed.length} check(s) failed.`,
        );
        process.exit(1);
      } else {
        console.log(
          c() ? chalk.yellow(`${warned.length} warning(s).`) : `${warned.length} warning(s).`,
        );
      }
    });
}
