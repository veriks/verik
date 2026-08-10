import { Command } from 'commander';
import { relative } from 'node:path';
import { formatError } from '../../shared/format-error.js';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { block, brand, muted, pass, section, subtle, warn } from '../output/theme.js';
import { checklist } from '../output/prompt.js';
import {
  installHook,
  readHookStatus,
  uninstallHook,
  type HookStatus,
} from '../../core/hooks/git-hooks.js';

/**
 * `crosscheck hook` — put verification in front of `git commit`.
 *
 * Everything else in this CLI has to be remembered. This is the one command
 * that makes the rest run on their own.
 */

const shown = (root: string, path: string): string => relative(root, path) || path;

function describe(root: string, status: HookStatus): string[] {
  const lines = [
    {
      label: 'hook',
      detail: shown(root, status.target.path),
      state: status.state === 'installed' ? ('ok' as const) : ('none' as const),
    },
    {
      label: 'status',
      detail:
        status.state === 'installed'
          ? 'installed'
          : status.state === 'foreign'
            ? 'another hook is present, crosscheck is not in it'
            : 'not installed',
      state:
        status.state === 'installed'
          ? ('ok' as const)
          : status.state === 'foreign'
            ? ('warn' as const)
            : ('none' as const),
    },
  ];

  if (status.target.hooksPathOverride) {
    // Worth stating plainly: with core.hooksPath set, anything written to
    // .git/hooks is never executed, and the mistake is invisible.
    lines.push({
      label: 'core.hooksPath',
      detail: `${status.target.hooksPathOverride} — git reads hooks from here`,
      state: 'ok' as const,
    });
  }

  return checklist(lines);
}

export function buildHookCommand(): Command {
  const cmd = new Command('hook').description(
    'Install crosscheck as a git pre-commit hook, so verification runs on its own',
  );

  cmd
    .command('install')
    .description('Add crosscheck to the pre-commit hook, preserving any hook already there')
    .option('--mode <mode>', 'Verification mode to run in the hook: rules or full', 'rules')
    .option('--prepend', 'Run crosscheck before the existing hook rather than after')
    .action(async (options: { mode: string; prepend?: boolean }) => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        if (options.mode !== 'rules' && options.mode !== 'full') {
          throw new Error(`Unknown mode "${options.mode}". Expected "rules" or "full".`);
        }

        const result = await installHook(info.root, {
          mode: options.mode,
          prepend: options.prepend,
        });

        console.log(`\n  ${section('pre-commit hook installed')}`);
        console.log(
          checklist([
            { label: 'file', detail: shown(info.root, result.target.path) },
            { label: 'mode', detail: `${options.mode} — no API key needed` },
            ...(result.preservedForeignContent
              ? [
                  {
                    label: 'existing hook',
                    detail: `preserved, crosscheck runs ${result.position === 'prepend' ? 'first' : 'after it'}`,
                  },
                ]
              : []),
            ...(result.backupPath
              ? [
                  {
                    label: 'backup',
                    detail: subtle(shown(info.root, result.backupPath)),
                    state: 'none' as const,
                  },
                ]
              : []),
          ]).join('\n'),
        );

        if (result.warning) console.log(`\n  ${warn('!')} ${result.warning}`);

        console.log(`\n  ${muted('From now on every commit is verified.')}`);
        console.log(`    ${brand('git commit --no-verify')}${muted('   skip it once')}`);
        console.log(
          `    ${brand('crosscheck hook uninstall')}${muted('   remove it completely')}\n`,
        );
      } catch (err) {
        console.error(`${block('✕')} ${formatError(err)}`);
        process.exit(1);
      }
    });

  cmd
    .command('uninstall')
    .description('Remove crosscheck from the pre-commit hook, leaving any other hook intact')
    .action(async () => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        const result = await uninstallHook(info.root);

        if (!result.removed) {
          console.log(`\n  ${muted('No crosscheck hook was installed — nothing to remove.')}\n`);
          return;
        }

        console.log(`\n  ${pass('✓')} ${muted('pre-commit hook removed')}`);
        if (result.restoredForeignContent) {
          console.log(
            `  ${subtle(`the hook that was there before crosscheck is intact at ${shown(info.root, result.target.path)}`)}`,
          );
        }
        console.log();
      } catch (err) {
        console.error(`${block('✕')} ${formatError(err)}`);
        process.exit(1);
      }
    });

  // Bare `crosscheck hook` reports rather than mutates. Installing a hook is a
  // change to how someone's git behaves and should always be asked for.
  cmd.action(async () => {
    try {
      const info = await getRepositoryInfo(process.cwd());
      const status = await readHookStatus(info.root);

      console.log(`\n  ${section('git hook')}`);
      console.log(describe(info.root, status).join('\n'));

      if (status.state !== 'installed') {
        console.log(`\n  ${muted('Run verification on every commit:')}`);
        console.log(`    ${brand('crosscheck hook install')}\n`);
      } else {
        console.log(`\n    ${brand('crosscheck hook uninstall')}${muted('   remove it')}\n`);
      }
    } catch (err) {
      console.error(`${block('✕')} ${formatError(err)}`);
      process.exit(1);
    }
  });

  return cmd;
}
