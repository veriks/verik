import { block } from '../output/theme.js';
import { formatError } from '../../shared/format-error.js';
import { Command } from 'commander';
import { bold, subtle, verdictTint } from '../output/theme.js';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { listRunIds } from '../../storage/local-run-store.js';
import { loadRunRecord } from '../../storage/local-run-store.js';
import { runFilePath } from '../../storage/paths.js';
import { readFile } from 'node:fs/promises';
import type { JudgeOutput } from '../../stages/judge/judge-schema.js';

// Shared palette, so a verdict is the same colour here, in a run summary, and
// in the HTML report.
function verdictColor(verdict: string): string {
  return verdictTint(verdict)(bold(verdict.toUpperCase()));
}

export function buildRunsCommand(): Command {
  return new Command('runs')
    .description('List recent verification runs')
    .option('--limit <n>', 'Number of runs to show', '20')
    .option('--verdict <v>', 'Filter by verdict: pass, warn, block, inconclusive')
    .option('--json', 'Machine-readable output')
    .action(async (options: { limit: string; verdict?: string; json?: boolean }) => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        const limit = Math.max(1, parseInt(options.limit, 10) || 20);
        const ids = await listRunIds(info.root);

        if (ids.length === 0) {
          console.log('No runs found. Try: crosscheck run -- <command>');
          return;
        }

        const rows = [];
        for (const id of ids.slice(0, Math.min(ids.length, limit * 3))) {
          // Load limit * 3 candidate records to allow for verdict filtering
          try {
            const record = await loadRunRecord(info.root, id);
            const judgePath = runFilePath(info.root, id, 'judge.json');
            let verdict: string | undefined;
            try {
              const raw = JSON.parse(await readFile(judgePath, 'utf8')) as
                { output?: JudgeOutput } | JudgeOutput;
              const judge =
                raw && typeof raw === 'object' && 'output' in raw && raw.output
                  ? raw.output
                  : (raw as JudgeOutput);
              verdict = judge?.verdict;
            } catch {
              // no judge output yet
            }
            rows.push({ id, record, verdict });
          } catch {
            // corrupt run — skip
          }
          if (rows.length >= limit * 3) break;
        }

        const filtered = options.verdict ? rows.filter((r) => r.verdict === options.verdict) : rows;

        const display = filtered.slice(0, limit);

        if (options.json) {
          console.log(
            JSON.stringify(
              display.map((r) => ({
                runId: r.id,
                startedAt: r.record.startedAt,
                command: r.record.wrappedCommand.join(' '),
                verdict: r.verdict ?? 'pending',
                fileCount: r.record.changedFiles?.length ?? 0,
                branch: r.record.branch,
              })),
              null,
              2,
            ),
          );
          return;
        }

        const colW = [22, 12, 11, 5, 36];
        const header = [
          'Run ID'.padEnd(colW[0]!),
          'Date'.padEnd(colW[1]!),
          'Verdict'.padEnd(colW[2]!),
          'Files'.padEnd(colW[3]!),
          'Command',
        ].join('  ');
        console.log(subtle(header));
        console.log(subtle('─'.repeat(90)));

        for (const { id, record, verdict } of display) {
          const date = new Date(record.startedAt).toLocaleDateString(undefined, {
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          });
          const cmd = record.wrappedCommand.join(' ');
          const truncCmd = cmd.length > 36 ? cmd.slice(0, 33) + '…' : cmd;
          const files = String(record.changedFiles?.length ?? '?');
          const v = verdict ? verdictColor(verdict) : subtle('—');
          console.log(
            [
              id.padEnd(colW[0]!),
              date.padEnd(colW[1]!),
              (verdict ?? '—')
                .toUpperCase()
                .padEnd(colW[2]!)
                .replace((verdict ?? '').toUpperCase(), v),
              files.padEnd(colW[3]!),
              truncCmd,
            ].join('  '),
          );
        }

        if (filtered.length === 0 && options.verdict) {
          console.log(`No runs with verdict "${options.verdict}" found.`);
        }
      } catch (err) {
        console.error(`${block('✕')} ${formatError(err)}`);
        process.exit(1);
      }
    });
}
