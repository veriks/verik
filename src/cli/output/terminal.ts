import chalk from 'chalk';
import type { PipelineResult } from '../../core/pipeline/verification-pipeline.js';
import type { OrchestratorResult } from '../../core/run/run-orchestrator.js';
import type { Finding } from '../../stages/reviewer/reviewer-schema.js';
import { runDir } from '../../storage/paths.js';
import { join, relative } from 'node:path';

const colorEnabled = (): boolean => !!process.stdout.isTTY && !process.env['NO_COLOR'];

/**
 * Wraps a chalk style so it becomes a no-op when colour is disabled. Lets the
 * rest of this file be written once instead of as paired if/else branches.
 */
const paint =
  (style: (s: string) => string) =>
  (s: string): string =>
    colorEnabled() ? style(s) : s;

const bold = paint(chalk.bold);
const dim = paint(chalk.dim);
const red = paint(chalk.red);
const green = paint(chalk.green);
const yellow = paint(chalk.yellow);
const cyan = paint(chalk.cyan);
const underline = paint(chalk.underline);

/** Total width of framed output, clamped so it stays readable in wide terminals. */
const frameWidth = (): number => Math.max(40, Math.min((process.stdout.columns ?? 80) - 2, 76));

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draws a titled box. Padding is computed from the raw strings before any
 * colour is applied — chalk's escape codes would otherwise corrupt the width.
 */
function box(title: string, body: string, tint: (s: string) => string): string[] {
  const w = frameWidth();
  const head = `─ ${title} `;
  const top = `╭${head}${'─'.repeat(Math.max(0, w - 2 - head.length))}╮`;
  const bottom = `╰${'─'.repeat(w - 2)}╯`;

  const out = [tint(top)];
  for (const line of wrap(body, w - 4)) {
    out.push(`${tint('│')} ${line.padEnd(w - 4)} ${tint('│')}`);
  }
  out.push(tint(bottom));
  return out;
}

const severityTint = (severity: string): ((s: string) => string) =>
  severity === 'critical' || severity === 'high' ? red : severity === 'medium' ? yellow : dim;

const verdictTint = (verdict: string): ((s: string) => string) =>
  verdict === 'block' ? red : verdict === 'warn' ? yellow : verdict === 'pass' ? green : dim;

/** Prefer a repo-relative path — absolute paths dominate the line and add no information. */
function shortPath(absolute: string): string {
  const rel = relative(process.cwd(), absolute);
  return !rel || rel.startsWith('..') ? absolute : rel;
}

export function printHeader(runId: string): void {
  console.log(`\n${bold('Crosscheck')} ${dim('·')} ${dim(runId)}`);
}

export function printCommand(command: string[]): void {
  console.log(dim('$ ') + cyan(command.join(' ')));
}

/**
 * Separator printed after the wrapped command exits and before verification
 * begins. Gives a clear visual break so users know where the agent output ends
 * and Crosscheck output begins.
 */
export function printVerificationSeparator(): void {
  const label = ' Crosscheck verification ';
  const side = Math.max(0, Math.floor((frameWidth() - label.length) / 2));
  const line = '─'.repeat(side);
  console.log(`\n${dim(line + label + line)}\n`);
}

export function printChanges(additions: number, deletions: number, fileCount: number): void {
  const files = `${fileCount} file${fileCount === 1 ? '' : 's'}`;
  console.log(`${dim(files)}  ${green(`+${additions}`)} ${red(`−${deletions}`)}\n`);
}

/** One aligned row per pipeline stage, so the four stages read as a single unit. */
function printStageRail(pipeline: PipelineResult): void {
  const { scout, builder, reviewer, judge } = pipeline;
  const row = (name: string, value: string) => console.log(`  ${dim(name.padEnd(10))}${value}`);

  if (scout) {
    const tint = severityTint(scout.riskLevel);
    const areas = scout.affectedAreas.length ? dim(` · ${scout.affectedAreas.join(' · ')}`) : '';
    row('Scout', tint(`${scout.riskLevel.toUpperCase()} RISK`) + areas);
  }

  if (builder) {
    const marks = builder.commands
      .map((cmd) =>
        cmd.status === 'passed'
          ? green(`✓ ${cmd.name}`)
          : cmd.status === 'failed'
            ? red(`✗ ${cmd.name}`)
            : dim(`– ${cmd.name}`),
      )
      .join('  ');
    row('Builder', marks || dim('no commands detected'));
  }

  if (reviewer) {
    const n = reviewer.findings.length;
    const high = reviewer.findings.filter(
      (f) => f.severity === 'high' || f.severity === 'critical',
    ).length;
    const summary = `${n} finding${n === 1 ? '' : 's'}`;
    row('Reviewer', n === 0 ? green(summary) : `${summary}${high ? red(` · ${high} high`) : ''}`);
  }

  if (judge) {
    const pct = Math.round(judge.confidence * 100);
    row(
      'Judge',
      verdictTint(judge.verdict)(bold(judge.verdict.toUpperCase())) + dim(` · ${pct}% confidence`),
    );
  }

  console.log();
}

/** The findings themselves — previously only counts were shown, so the actual result was invisible. */
function printFindings(findings: Finding[], limit = 5): void {
  if (!findings.length) return;

  const order = ['critical', 'high', 'medium', 'low', 'info'];
  const ranked = [...findings].sort(
    (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
  );

  console.log(bold('Findings'));
  for (const f of ranked.slice(0, limit)) {
    const badge = severityTint(f.severity)(f.severity.toUpperCase().padEnd(8));
    console.log(`  ${badge}${f.title}`);
    const ev = f.evidence[0];
    if (ev) {
      const loc = ev.startLine ? `:${ev.startLine}` : '';
      console.log(`  ${' '.repeat(8)}${dim(ev.path + loc)}`);
    }
  }
  if (ranked.length > limit) {
    console.log(dim(`  … ${ranked.length - limit} more in the full report`));
  }
  console.log();
}

export function printVerdictSummary(
  pipeline: PipelineResult,
  result: OrchestratorResult,
  intent?: string,
): void {
  const { scout, reviewer, judge } = pipeline;

  printStageRail(pipeline);

  if (judge) {
    for (const line of box(
      judge.verdict.toUpperCase(),
      judge.summary,
      verdictTint(judge.verdict),
    )) {
      console.log(line);
    }
    console.log();
  }

  if (reviewer) printFindings(reviewer.findings);

  // The Judge dismissing Reviewer findings is a deliberate design property —
  // surface it so a lower finding count doesn't look like a missed detection.
  const dismissed = judge?.dismissedFindings.length ?? 0;
  if (dismissed) {
    console.log(
      dim(`  Judge dismissed ${dismissed} finding${dismissed === 1 ? '' : 's'} as unsupported.\n`),
    );
  }

  const reportPath = shortPath(join(runDir(result.repoRoot, result.runId), 'report.md'));
  console.log(`${dim('Report')}  ${underline(reportPath)}`);

  // Nudge: if Scout found HIGH/CRITICAL risk and no intent was provided,
  // remind the user that --intent improves analysis quality.
  if (scout && !intent && (scout.riskLevel === 'high' || scout.riskLevel === 'critical')) {
    console.log(
      dim(`\nTip: re-run with --intent "what this change was meant to do" for sharper analysis.`),
    );
  }

  console.log();
}

export function printNoChanges(): void {
  console.log(dim('Crosscheck: no repository changes detected.'));
}

export function printError(message: string): void {
  console.error(`${red('Error:')} ${message}`);
}

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}
