import chalk from 'chalk';
import type { PipelineResult } from '../../core/pipeline/verification-pipeline.js';
import type { OrchestratorResult } from '../../core/run/run-orchestrator.js';
import { runDir } from '../../storage/paths.js';
import { join } from 'node:path';

const isColorEnabled = () => process.stdout.isTTY && !process.env['NO_COLOR'];

export function printHeader(runId: string): void {
  const c = isColorEnabled();
  if (c) {
    console.log('\n' + chalk.bold.blue('Crosscheck'));
    console.log(chalk.dim('Run ' + runId) + '\n');
  } else {
    console.log('\nCrosscheck');
    console.log('Run ' + runId + '\n');
  }
}

export function printCommand(command: string[]): void {
  const c = isColorEnabled();
  if (c) {
    console.log(chalk.bold('Command'));
    console.log('  ' + chalk.cyan(command.join(' ')) + '\n');
  } else {
    console.log('Command');
    console.log('  ' + command.join(' ') + '\n');
  }
}

/**
 * Separator printed after the wrapped command exits and before verification
 * begins. Gives a clear visual break so users know where the agent output ends
 * and Crosscheck output begins.
 */
export function printVerificationSeparator(): void {
  const c = isColorEnabled();
  const cols = process.stdout.columns ?? 72;
  const label = ' Crosscheck verification ';
  const lineLen = Math.max(0, Math.floor((cols - label.length) / 2));
  const line = '─'.repeat(lineLen);
  const separator = `\n${line}${label}${line}`;
  if (c) {
    console.log(chalk.dim(separator) + '\n');
  } else {
    console.log(separator + '\n');
  }
}

export function printChanges(additions: number, deletions: number, fileCount: number): void {
  const c = isColorEnabled();
  if (c) {
    console.log(chalk.bold('Changes'));
    console.log(`  ${fileCount} files changed`);
    console.log(`  ${chalk.green('+' + additions)} / ${chalk.red('-' + deletions)}\n`);
  } else {
    console.log('Changes');
    console.log(`  ${fileCount} files changed, +${additions} / -${deletions}\n`);
  }
}

export function printVerdictSummary(
  pipeline: PipelineResult,
  result: OrchestratorResult,
  intent?: string,
): void {
  const c = isColorEnabled();
  const { scout, builder, reviewer, judge, policy } = pipeline;

  if (scout) {
    const riskColor = scout.riskLevel === 'critical' || scout.riskLevel === 'high'
      ? chalk.red : scout.riskLevel === 'medium' ? chalk.yellow : chalk.green;
    if (c) {
      console.log(chalk.bold('Scout'));
      console.log('  ' + riskColor(scout.riskLevel.toUpperCase() + ' RISK'));
      if (scout.affectedAreas.length) console.log('  ' + chalk.dim(scout.affectedAreas.join(' · ')));
    } else {
      console.log('Scout');
      console.log('  ' + scout.riskLevel.toUpperCase() + ' RISK');
    }
    console.log();
  }

  if (builder) {
    const icon = (status: string) =>
      status === 'passed' ? (c ? chalk.green('✓') : '✓')
      : status === 'failed' ? (c ? chalk.red('✗') : '✗') : '~';
    if (c) console.log(chalk.bold('Builder')); else console.log('Builder');
    for (const cmd of builder.commands) {
      console.log(`  ${icon(cmd.status)} ${cmd.name}`);
    }
    console.log();
  }

  if (reviewer) {
    const high = reviewer.findings.filter((f) => f.severity === 'high' || f.severity === 'critical').length;
    const med  = reviewer.findings.filter((f) => f.severity === 'medium').length;
    const low  = reviewer.findings.filter((f) => f.severity === 'low' || f.severity === 'info').length;
    if (c) console.log(chalk.bold('Reviewer')); else console.log('Reviewer');
    console.log(`  ${high > 0 ? (c ? chalk.red(high + ' high') : high + ' high') : '0 high'} · ${med} medium · ${low} low`);
    console.log();
  }

  if (judge && policy) {
    const verdictStr = judge.verdict.toUpperCase();
    const verdictColor = judge.verdict === 'block'
      ? chalk.red.bold : judge.verdict === 'warn' ? chalk.yellow.bold : chalk.green.bold;
    if (c) console.log(chalk.bold('Judge')); else console.log('Judge');
    console.log('  ' + (c ? verdictColor(verdictStr) : verdictStr) + ` · ${Math.round(judge.confidence * 100)}% confidence`);
    console.log();
    console.log('  ' + judge.summary);
    if (judge.reasons[0]?.findingIds.length && reviewer) {
      const firstId = judge.reasons[0]?.findingIds[0];
      const f = reviewer.findings.find((fi) => fi.id === firstId);
      if (f?.evidence[0]) {
        const loc = f.evidence[0].startLine ? `:${f.evidence[0].startLine}` : '';
        console.log(`  Evidence: ${f.evidence[0].path}${loc}`);
      }
    }
    console.log();
  }

  const reportPath = join(runDir(result.repoRoot, result.runId), 'report.md');
  console.log('Full report:');
  console.log('  ' + (c ? chalk.underline(reportPath) : reportPath));

  // Nudge: if Scout found HIGH/CRITICAL risk and no intent was provided,
  // remind the user that --intent improves analysis quality.
  if (scout && !intent && (scout.riskLevel === 'high' || scout.riskLevel === 'critical')) {
    console.log();
    const tip = `Tip: re-run with --intent "what this change was meant to do" for more accurate analysis.`;
    if (c) console.log(chalk.dim('  ' + tip));
    else console.log('  ' + tip);
  }

  console.log();
}

export function printNoChanges(): void {
  console.log('Crosscheck: no repository changes detected.');
}

export function printError(message: string): void {
  const c = isColorEnabled();
  if (c) console.error(chalk.red('Error: ') + message);
  else console.error('Error: ' + message);
}

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}
