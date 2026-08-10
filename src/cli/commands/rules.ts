import { Command } from 'commander';
import { formatError } from '../../shared/format-error.js';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { loadPolicy, savePolicy } from '../../config/config-loader.js';
import { listRules, type RuleSummary } from '../../stages/reviewer/deterministic-rules/index.js';
import { block, bold, brand, muted, pass, section, severityTint, subtle } from '../output/theme.js';
import type { PolicyConfig } from '../../config/config-schema.js';
import type { Severity } from '../../shared/schemas.js';

/**
 * `crosscheck rules` — see and tune the deterministic rules.
 *
 * Two levers, and the order they appear in the help matters. `severity` keeps a
 * finding in the report while stopping it blocking, so nothing is lost;
 * `disable` is the escape hatch and demands a written reason, because a check
 * someone silently switched off is exactly what this tool exists to make
 * visible.
 */

const SEVERITIES: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

const today = (): string => new Date().toISOString().slice(0, 10);

async function resolveRule(id: string): Promise<RuleSummary> {
  const rules = await listRules();
  const found = rules.find((r) => r.id === id);
  if (!found) {
    // Listing the alternatives costs one line and saves a round trip.
    throw new Error(`Unknown rule "${id}".\nKnown rules: ${rules.map((r) => r.id).join(', ')}`);
  }
  return found;
}

function renderList(rules: RuleSummary[], policy: PolicyConfig): string[] {
  const disabled = new Map(policy.rules.disabled.map((d) => [d.id, d.reason]));
  const remapped = policy.rules.severity;
  const idWidth = Math.max(...rules.map((r) => r.id.length)) + 2;

  return rules.map((rule) => {
    const off = disabled.get(rule.id);
    const to = remapped[rule.id];

    if (off !== undefined) {
      return `  ${subtle('○')} ${subtle(rule.id.padEnd(idWidth))}${subtle('disabled')} ${subtle(`— ${off}`)}`;
    }

    const severity = to ?? rule.severity;
    const tint = severityTint(severity);
    const changed = to ? subtle(` (was ${rule.severity})`) : '';
    return `  ${tint('●')} ${bold(rule.id.padEnd(idWidth))}${tint(severity.padEnd(9))}${muted(rule.title)}${changed}`;
  });
}

export function buildRulesCommand(): Command {
  const cmd = new Command('rules').description(
    'List and tune the deterministic rules — no API key involved',
  );

  cmd
    .command('list', { isDefault: true })
    .description('Show every rule, its severity, and whether policy has changed it')
    .option('--json', 'Machine-readable output')
    .action(async (options: { json?: boolean }) => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        const [rules, policy] = await Promise.all([listRules(), loadPolicy(info.root)]);

        if (options.json) {
          const disabled = new Map(policy.rules.disabled.map((d) => [d.id, d.reason]));
          console.log(
            JSON.stringify(
              rules.map((r) => ({
                id: r.id,
                title: r.title,
                defaultSeverity: r.severity,
                effectiveSeverity: policy.rules.severity[r.id] ?? r.severity,
                disabled: disabled.has(r.id),
                disabledReason: disabled.get(r.id) ?? null,
              })),
              null,
              2,
            ),
          );
          return;
        }

        const offCount = policy.rules.disabled.length;
        console.log(`\n  ${section(`${rules.length} deterministic rules`)}`);
        console.log(renderList(rules, policy).join('\n'));
        console.log(
          `\n  ${muted(`blocking at ${policy.blockAtSeverity} and above · policy mode ${policy.mode}`)}`,
        );
        if (offCount) console.log(`  ${muted(`${offCount} disabled`)}`);
        console.log(
          `\n    ${brand('crosscheck rules severity <id> <level>')}${muted('   keep it, stop it blocking')}`,
        );
        console.log(
          `    ${brand('crosscheck rules disable <id> --reason "…"')}${muted('   turn it off')}\n`,
        );
      } catch (err) {
        console.error(`${block('✕')} ${formatError(err)}`);
        process.exit(1);
      }
    });

  cmd
    .command('severity')
    .description("Change a rule's severity — it stays in the report either way")
    .argument('<id>', 'Rule ID')
    .argument('<level>', `One of: ${SEVERITIES.join(', ')}`)
    .action(async (id: string, level: string) => {
      try {
        if (!SEVERITIES.includes(level as Severity)) {
          throw new Error(`Unknown severity "${level}". Expected one of: ${SEVERITIES.join(', ')}`);
        }
        const info = await getRepositoryInfo(process.cwd());
        const rule = await resolveRule(id);
        const policy = await loadPolicy(info.root);

        if (level === rule.severity) delete policy.rules.severity[id];
        else policy.rules.severity[id] = level as Severity;
        await savePolicy(info.root, policy);

        const tint = severityTint(level);
        console.log(
          `\n  ${pass('✓')} ${bold(id)} ${muted('is now')} ${tint(level)}${muted(level === rule.severity ? ' (back to its default)' : '')}`,
        );
        console.log(
          `  ${subtle(`findings still appear in the report; blocking is at ${policy.blockAtSeverity} and above`)}\n`,
        );
      } catch (err) {
        console.error(`${block('✕')} ${formatError(err)}`);
        process.exit(1);
      }
    });

  cmd
    .command('disable')
    .description('Turn a rule off. Its findings are recorded as suppressed, never dropped')
    .argument('<id>', 'Rule ID')
    .requiredOption(
      '--reason <text>',
      'Why this rule does not apply here — recorded in policy.json',
    )
    .action(async (id: string, options: { reason: string }) => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        await resolveRule(id);
        const policy = await loadPolicy(info.root);

        policy.rules.disabled = [
          ...policy.rules.disabled.filter((d) => d.id !== id),
          { id, reason: options.reason, at: today() },
        ];
        delete policy.rules.severity[id];
        await savePolicy(info.root, policy);

        console.log(`\n  ${pass('✓')} ${bold(id)} ${muted('disabled')}`);
        console.log(`  ${subtle(`reason: ${options.reason}`)}`);
        console.log(
          `  ${subtle('recorded in .crosscheck/policy.json — it will show up in your next pull request')}\n`,
        );
      } catch (err) {
        console.error(`${block('✕')} ${formatError(err)}`);
        process.exit(1);
      }
    });

  cmd
    .command('enable')
    .description('Turn a rule back on')
    .argument('<id>', 'Rule ID')
    .action(async (id: string) => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        const policy = await loadPolicy(info.root);

        const before = policy.rules.disabled.length;
        policy.rules.disabled = policy.rules.disabled.filter((d) => d.id !== id);
        if (policy.rules.disabled.length === before) {
          console.log(`\n  ${muted(`${id} was not disabled — nothing to do.`)}\n`);
          return;
        }
        await savePolicy(info.root, policy);
        console.log(`\n  ${pass('✓')} ${bold(id)} ${muted('enabled')}\n`);
      } catch (err) {
        console.error(`${block('✕')} ${formatError(err)}`);
        process.exit(1);
      }
    });

  return cmd;
}
