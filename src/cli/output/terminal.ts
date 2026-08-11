import type { PipelineResult } from '../../core/pipeline/verification-pipeline.js';
import type { OrchestratorResult } from '../../core/run/run-orchestrator.js';
import type { Finding } from '../../stages/reviewer/reviewer-schema.js';
import { runDir } from '../../storage/paths.js';
import { join, relative } from 'node:path';
import {
  bold,
  box,
  brand,
  block,
  frameWidth,
  MARK_RAW,
  mark,
  muted,
  pass,
  rule,
  severityTint,
  subtle,
  underline,
  verdictTint,
  wordmark,
} from './theme.js';

/** Prefer a repo-relative path — absolute paths dominate the line and add no information. */
function shortPath(absolute: string): string {
  const rel = relative(process.cwd(), absolute);
  return !rel || rel.startsWith('..') ? absolute : rel;
}

export function printHeader(runId: string): void {
  const left = `${mark()}  ${bold('verik')}`;
  // Pad on the raw text, not the coloured string — escape codes have no width.
  const rawLeft = `${MARK_RAW}  verik`;
  const gap = Math.max(1, frameWidth() - rawLeft.length - runId.length);
  console.log(`\n${left}${' '.repeat(gap)}${subtle(runId)}`);
  console.log(rule());
}

export function printCommand(command: string[]): void {
  console.log(`${brand('$')} ${command.join(' ')}`);
}

/**
 * Separator printed after the wrapped command exits and before verification
 * begins. Gives a clear visual break so users know where the agent output ends
 * and Verik output begins.
 */
export function printVerificationSeparator(): void {
  console.log(`\n${rule('verik')}\n`);
}

export function printChanges(additions: number, deletions: number, fileCount: number): void {
  const files = `${fileCount} file${fileCount === 1 ? '' : 's'}`;
  console.log(
    `${muted(files)} ${subtle('·')} ${pass(`+${additions}`)} ${block(`−${deletions}`)}\n`,
  );
}

/**
 * One row per pipeline stage, hung off a brand-coloured rail so the four
 * stages read as a single connected pipeline rather than four separate blocks.
 */
function printStageRail(pipeline: PipelineResult): void {
  const { scout, builder, reviewer, judge } = pipeline;
  const rail = brand('│');
  const row = (name: string, value: string) =>
    console.log(`${rail}  ${muted(name.padEnd(10))}${value}`);

  if (scout) {
    const areas = scout.affectedAreas.length ? subtle(` · ${scout.affectedAreas.join(' · ')}`) : '';
    row('Scout', severityTint(scout.riskLevel)(`${scout.riskLevel.toUpperCase()} RISK`) + areas);
  }

  if (builder) {
    const marks = builder.commands
      .map((cmd) =>
        cmd.status === 'passed'
          ? pass(`✓ ${cmd.name}`)
          : cmd.status === 'failed'
            ? block(`✗ ${cmd.name}`)
            : subtle(`– ${cmd.name}`),
      )
      .join('  ');
    row('Builder', marks || subtle('no commands detected'));
  }

  if (reviewer) {
    const n = reviewer.findings.length;
    const high = reviewer.findings.filter(
      (f) => f.severity === 'high' || f.severity === 'critical',
    ).length;
    const label = `${n} finding${n === 1 ? '' : 's'}`;
    row('Reviewer', n === 0 ? pass(label) : label + (high ? block(` · ${high} high`) : ''));
  }

  if (judge) {
    const pct = Math.round(judge.confidence * 100);
    row(
      'Judge',
      verdictTint(judge.verdict)(bold(judge.verdict.toUpperCase())) + subtle(` · ${pct}%`),
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

  console.log(muted('FINDINGS'));
  for (const f of ranked.slice(0, limit)) {
    const tint = severityTint(f.severity);
    // A colour bar carries severity at a glance; the label keeps it readable
    // without colour and for anyone who can't distinguish the hues.
    console.log(`${tint('▊')} ${tint(f.severity.toUpperCase().padEnd(9))}${f.title}`);
    const ev = f.evidence[0];
    if (ev) {
      const loc = ev.startLine ? `:${ev.startLine}` : '';
      console.log(`${tint('▊')} ${' '.repeat(9)}${subtle(ev.path + loc)}`);
    }
  }
  if (ranked.length > limit) {
    console.log(subtle(`  … ${ranked.length - limit} more in the full report`));
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

  // A rule that was turned off must still leave a mark. Without this line the
  // only way to know a finding was silenced is to read policy.json and infer
  // it, which is exactly the silent failure the reason field exists to prevent.
  if (pipeline.suppressedFindings?.length) {
    const byPolicy = pipeline.suppressedFindings.filter((s) => s.source === 'policy').length;
    const parts = [
      byPolicy ? `${byPolicy} by policy` : '',
      pipeline.suppressedFindings.length - byPolicy
        ? `${pipeline.suppressedFindings.length - byPolicy} by override`
        : '',
    ].filter(Boolean);
    console.log(
      subtle(`  ${pipeline.suppressedFindings.length} finding(s) suppressed — ${parts.join(', ')}`),
    );
  }

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

  // Rule output first and labelled: these are facts, not model opinion, and
  // they are present even when the Reviewer stage failed.
  if (pipeline.deterministicFindings.length) {
    console.log(muted('RULES'));
    for (const f of pipeline.deterministicFindings) {
      const tint = severityTint(f.severity);
      console.log(`${tint('▊')} ${tint(f.severity.toUpperCase().padEnd(9))}${f.title}`);
      console.log(
        `${tint('▊')} ${' '.repeat(9)}${subtle(f.file + (f.line ? `:${f.line}` : ''))} ${subtle(`· ${f.ruleId}`)}`,
      );
    }
    console.log();
  }

  if (reviewer) printFindings(reviewer.findings);

  // The Judge dismissing Reviewer findings is a deliberate design property —
  // surface it so a lower finding count doesn't look like a missed detection.
  const dismissed = judge?.dismissedFindings.length ?? 0;
  if (dismissed) {
    console.log(
      subtle(`Judge dismissed ${dismissed} finding${dismissed === 1 ? '' : 's'} as unsupported.\n`),
    );
  }

  const reportPath = shortPath(join(runDir(result.repoRoot, result.runId), 'report.md'));
  console.log(`${muted('report')}  ${underline(brand(reportPath))}`);

  // Nudge: if Scout found HIGH/CRITICAL risk and no intent was provided,
  // remind the user that --intent improves analysis quality.
  if (scout && !intent && (scout.riskLevel === 'high' || scout.riskLevel === 'critical')) {
    console.log(
      subtle(
        `\nTip: re-run with --intent "what this change was meant to do" for sharper analysis.`,
      ),
    );
  }

  console.log();
}

export function printNoChanges(): void {
  console.log(`${wordmark()}  ${muted('no repository changes detected.')}`);
}

export function printError(message: string): void {
  console.error(`${block('✕')} ${message}`);
}

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}
