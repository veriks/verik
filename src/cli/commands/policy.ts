import { Command } from 'commander';
import { formatError } from '../../shared/format-error.js';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { loadPolicy, savePolicy } from '../../config/config-loader.js';
import { block, bold, brand, muted, pass, section, severityTint, subtle } from '../output/theme.js';
import { checklist } from '../output/prompt.js';

/**
 * `crosscheck policy` — how strict this repository is.
 *
 * The file stays the source of truth. This command exists so nobody has to
 * hand-edit JSON and so an invalid value fails here, with a sentence, rather
 * than at the start of someone's next commit.
 */

const MODES = ['shadow', 'advisory', 'blocking'] as const;
type Mode = (typeof MODES)[number];

const EXPLAIN: Record<Mode, string> = {
  shadow: 'records a verdict and never changes the exit code',
  advisory: 'reports findings, always exits 0',
  blocking: 'exits 2 when a finding meets the threshold',
};

export function buildPolicyCommand(): Command {
  const cmd = new Command('policy').description('Show or change the verification policy');

  cmd
    .command('show', { isDefault: true })
    .description('Show the policy in force')
    .option('--json', 'Machine-readable output')
    .action(async (options: { json?: boolean }) => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        const policy = await loadPolicy(info.root);

        if (options.json) {
          console.log(JSON.stringify(policy, null, 2));
          return;
        }

        console.log(`\n  ${section('policy')}`);
        console.log(
          checklist([
            { label: 'mode', detail: `${bold(policy.mode)} ${muted(`— ${EXPLAIN[policy.mode]}`)}` },
            {
              label: 'blocks at',
              detail: `${severityTint(policy.blockAtSeverity)(policy.blockAtSeverity)} ${muted('and above')}`,
            },
            {
              label: 'confidence',
              detail: `${Math.round(policy.minimumBlockingConfidence * 100)}% ${muted('minimum, for LLM findings')}`,
            },
            {
              label: 'builder',
              detail: policy.requireBuilderSuccess
                ? 'must pass'
                : muted('advisory — a failing build does not block on its own'),
              state: policy.requireBuilderSuccess ? ('ok' as const) : ('none' as const),
            },
            ...(policy.rules.disabled.length
              ? [
                  {
                    label: 'rules off',
                    detail: policy.rules.disabled.map((d) => d.id).join(', '),
                    state: 'warn' as const,
                  },
                ]
              : []),
          ]).join('\n'),
        );
        console.log(
          `\n    ${brand('crosscheck policy mode <mode>')}${muted(`   ${MODES.join(' · ')}`)}`,
        );
        console.log(`    ${brand('crosscheck rules')}${muted('   per-rule tuning')}\n`);
      } catch (err) {
        console.error(`${block('✕')} ${formatError(err)}`);
        process.exit(1);
      }
    });

  cmd
    .command('mode')
    .description('Set how the policy affects the exit code')
    .argument('<mode>', MODES.join(' | '))
    .action(async (mode: string) => {
      try {
        if (!MODES.includes(mode as Mode)) {
          throw new Error(`Unknown mode "${mode}". Expected one of: ${MODES.join(', ')}`);
        }
        const info = await getRepositoryInfo(process.cwd());
        const policy = await loadPolicy(info.root);
        const previous = policy.mode;
        policy.mode = mode as Mode;
        await savePolicy(info.root, policy);

        console.log(
          `\n  ${pass('✓')} ${muted('policy mode')} ${bold(previous)} ${muted('→')} ${bold(mode)}`,
        );
        console.log(`  ${subtle(EXPLAIN[mode as Mode])}\n`);
      } catch (err) {
        console.error(`${block('✕')} ${formatError(err)}`);
        process.exit(1);
      }
    });

  cmd
    .command('block-at')
    .description('Set the severity at which findings start blocking')
    .argument('<severity>', 'info | low | medium | high | critical')
    .action(async (severity: string) => {
      try {
        const levels = ['info', 'low', 'medium', 'high', 'critical'] as const;
        if (!levels.includes(severity as (typeof levels)[number])) {
          throw new Error(`Unknown severity "${severity}". Expected one of: ${levels.join(', ')}`);
        }
        const info = await getRepositoryInfo(process.cwd());
        const policy = await loadPolicy(info.root);
        policy.blockAtSeverity = severity as (typeof levels)[number];
        await savePolicy(info.root, policy);

        console.log(
          `\n  ${pass('✓')} ${muted('blocking at')} ${severityTint(severity)(severity)} ${muted('and above')}`,
        );
        if (policy.mode !== 'blocking') {
          console.log(
            `  ${subtle(`policy mode is ${policy.mode}, so nothing blocks yet — crosscheck policy mode blocking`)}`,
          );
        }
        console.log();
      } catch (err) {
        console.error(`${block('✕')} ${formatError(err)}`);
        process.exit(1);
      }
    });

  return cmd;
}
