import { block } from '../output/theme.js';
import { formatError } from '../../shared/format-error.js';
import { Command } from 'commander';
import chalk from 'chalk';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { computeWorktreeDiff } from '../../core/repository/diff-capture.js';
import { loadConfig, loadPolicy } from '../../config/config-loader.js';
import { getOrCreateFingerprint } from '../../core/repository/repo-fingerprint.js';
import { selectContext } from '../../core/context/context-selector.js';
import { detectProject } from '../../stages/builder/project-detector.js';
import { planCommands } from '../../stages/builder/command-planner.js';
import { getActiveOverrides } from '../../core/memory/memory-store.js';

const c = () => process.stdout.isTTY && !process.env['NO_COLOR'];
const dim = (s: string) => (c() ? chalk.dim(s) : s);
const bold = (s: string) => (c() ? chalk.bold(s) : s);
const green = (s: string) => (c() ? chalk.green(s) : s);
const yellow = (s: string) => (c() ? chalk.yellow(s) : s);
const red = (s: string) => (c() ? chalk.red(s) : s);

export function buildDryRunCommand(): Command {
  return new Command('dry-run')
    .description('Preview what crosscheck run would do — no subprocess, no LLM calls')
    .argument('<command...>', 'Command that would be run (after --)')
    .option('--intent <text>', 'User intent description')
    .action(async (commandArgs: string[], _options: { intent?: string }) => {
      try {
        const cwd = process.cwd();
        const info = await getRepositoryInfo(cwd);
        const root = info.root;

        const [config, fingerprint] = await Promise.all([
          loadConfig(root),
          getOrCreateFingerprint(root, info.remote),
        ]);
        const policy = await loadPolicy(root);

        console.log(bold('\nCrosscheck Dry Run'));
        console.log(dim(`Would run: ${commandArgs.join(' ')}\n`));

        // Repository state
        console.log(bold('Repository'));
        console.log(`  ${root}`);
        console.log(`  Branch: ${info.branch}  Commit: ${info.commitSha.slice(0, 8)}`);
        console.log(`  Repo ID: ${fingerprint.repoId}`);
        console.log(
          `  Dirty: ${info.isDirty ? yellow('yes (pre-existing changes exist)') : green('no')}`,
        );
        console.log();

        // Current diff (what would be attributed to the command if run now)
        const { diff } = await computeWorktreeDiff({
          root,
          maxDiffBytes: config.verification.maxDiffBytes,
          excludePatterns: config.privacy.excludePatterns,
          includeUntracked: config.verification.includeUntrackedFiles,
        });

        if (diff.changedFiles.length > 0) {
          console.log(
            yellow('⚠ Repository has uncommitted changes that would be treated as pre-existing:'),
          );
          for (const f of diff.changedFiles.slice(0, 8)) {
            console.log(dim(`  ${f.changeType}: ${f.path}`));
          }
          if (diff.changedFiles.length > 8)
            console.log(dim(`  ... and ${diff.changedFiles.length - 8} more`));
          console.log();
        }

        // Policy
        console.log(bold('Policy'));
        console.log(`  Mode: ${policy.mode}`);
        console.log(
          `  Block at: ${policy.blockAtSeverity} severity ≥ ${policy.minimumBlockingConfidence * 100}% confidence`,
        );
        console.log();

        // Builder
        console.log(bold('Builder (deterministic)'));
        const detection = detectProject(root);
        console.log(
          `  Project: ${detection.projectTypes.join(', ')}${detection.packageManager ? ` · ${detection.packageManager}` : ''}`,
        );
        const planned = planCommands(detection, config.builder.commands ?? []);
        if (planned.length === 0) {
          console.log(`  ${dim('No commands detected')}`);
        } else {
          for (const p of planned) {
            console.log(`  ${green('→')} ${p.command}`);
          }
        }
        console.log(`  Timeout: ${config.builder.timeoutMs / 1000}s per command`);
        console.log();

        // Context budget
        console.log(bold('Context budget (per LLM call)'));
        const sampleDiff = {
          ...diff,
          changedFiles: [],
          commandIntroducedPaths: [],
          preExistingChangedPaths: [],
        };
        const ctx = await selectContext({
          repoRoot: root,
          diff: sampleDiff,
          maxDiffBytes: config.verification.maxDiffBytes,
          maxFileBytes: config.verification.maxFileBytes,
          maxTotalTokens: 60_000,
          excludePatterns: config.privacy.excludePatterns,
        });
        console.log(`  Max tokens: 60,000`);
        console.log(`  Inference timeout: ${config.inferenceTimeoutMs / 1000}s per stage`);
        if (ctx.limitations.length) {
          for (const l of ctx.limitations) console.log(`  ${yellow('~')} ${l}`);
        }
        console.log();

        // Models
        console.log(bold('Models'));
        const apiKey = process.env['ANTHROPIC_API_KEY'];
        if (!apiKey) {
          console.log(`  ${red('✗')} ANTHROPIC_API_KEY not set — LLM stages would be skipped`);
        } else {
          console.log(`  Scout:    ${config.models.scout}`);
          console.log(`  Reviewer: ${config.models.reviewer}`);
          console.log(`  Judge:    ${config.models.judge}`);
        }
        console.log();

        // Active overrides
        const overrides = await getActiveOverrides(root);
        if (overrides.length > 0) {
          console.log(bold(`Active overrides (${overrides.length})`));
          for (const o of overrides) {
            const scope = [
              o.ruleId && `rule:${o.ruleId}`,
              o.filePath && `path:${o.filePath}`,
              o.titlePattern && `title:/${o.titlePattern}/`,
            ]
              .filter(Boolean)
              .join(', ');
            console.log(`  ${dim(o.id)}  ${scope || 'all'}  — ${o.reason}`);
          }
          console.log();
        }

        console.log(dim('Run without --dry-run to execute.'));
        console.log();
      } catch (err) {
        console.error(`${block('✕')} ${formatError(err)}`);
        process.exit(1);
      }
    });
}
