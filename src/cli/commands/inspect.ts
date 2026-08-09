import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { listRunIds } from '../../storage/local-run-store.js';
import { runFilePath } from '../../storage/paths.js';
import type { RunRecord } from '../../core/run/run-state.js';

const c = () => process.stdout.isTTY && !process.env['NO_COLOR'];

function head(text: string) {
  return c() ? chalk.bold.blue(text) : text;
}
function dim(text: string) {
  return c() ? chalk.dim(text) : text;
}
function ok(text: string) {
  return c() ? chalk.green(text) : text;
}
function warn(text: string) {
  return c() ? chalk.yellow(text) : text;
}
function bad(text: string) {
  return c() ? chalk.red(text) : text;
}

export function buildInspectCommand(): Command {
  return new Command('inspect')
    .description('Show context sent, files excluded, token usage, evidence, and stage identity for a run')
    .argument('[run-id]', 'Run ID (defaults to latest)')
    .option('--prompt', 'Include rendered prompt hashes')
    .option('--json', 'Machine-readable output')
    .action(async (runId: string | undefined, options: { prompt?: boolean; json?: boolean }) => {
      try {
        const info = await getRepositoryInfo(process.cwd());
        let id = runId;
        if (!id) {
          const ids = await listRunIds(info.root);
          id = ids[0];
          if (!id) {
            console.log('No runs found.');
            return;
          }
        }

        const load = async <T>(file: string): Promise<T | null> => {
          try {
            return JSON.parse(await readFile(runFilePath(info.root, id!, file), 'utf8')) as T;
          } catch {
            return null;
          }
        };

        const metadata = await load<RunRecord>('metadata.json');
        const scout    = await load<{ status: string; output: unknown } & StageMeta>('scout.json');
        const builder  = await load<{ status: string; output: unknown } & StageMeta>('builder.json');
        const reviewer = await load<{ status: string; output: unknown } & StageMeta>('reviewer.json');
        const judge    = await load<{ status: string; output: unknown } & StageMeta>('judge.json');
        const evidence = await load<unknown[]>('evidence.json');
        const report   = await load<ReportJson>('report.json');

        if (options.json) {
          console.log(JSON.stringify({ id, metadata, scout, builder, reviewer, judge, evidence }, null, 2));
          return;
        }

        console.log(head(`\nCrosscheck Inspect`));
        console.log(dim(`Run: ${id}`));
        if (metadata) {
          console.log(dim(`Repo: ${metadata.repoId ?? 'unknown'} — ${metadata.repositoryPath}`));
          console.log(dim(`Command: ${metadata.wrappedCommand.join(' ')}`));
          console.log(dim(`Branch: ${metadata.branch}  Commit: ${metadata.baselineCommitSha}`));
        }

        // Attributable diff
        if (report?.attributableDiff) {
          const d = report.attributableDiff;
          console.log(`\n${head('Attributable Diff')}`);
          console.log(`  +${d.additions} / -${d.deletions}  (${d.commandIntroducedPaths?.length ?? 0} files introduced by this command)`);
          if (d.preExistingPaths?.length) {
            console.log(dim(`  Pre-existing (not attributed): ${d.preExistingPaths.join(', ')}`));
          }
          if (d.truncated) console.log(warn('  Diff was truncated — context may be incomplete'));
        }

        // Stage identity table
        console.log(`\n${head('Stage Identity')}`);
        const stages = [
          { name: 'Scout',    data: scout },
          { name: 'Builder',  data: builder },
          { name: 'Reviewer', data: reviewer },
          { name: 'Judge',    data: judge },
        ];
        for (const { name, data } of stages) {
          if (!data) { console.log(`  ${name.padEnd(10)} ${dim('no data')}`); continue; }
          const status = data.status === 'completed' ? ok(data.status)
            : data.status === 'failed' ? bad(data.status)
            : data.status === 'skipped' ? dim(data.status)
            : warn(data.status ?? 'unknown');

          const model = data.model ? `  model=${data.model}` : '';
          const pv = data.promptVersion ? `  prompt@${data.promptVersion}` : '';
          const ph = options.prompt && data.promptHash ? `  promptHash=${data.promptHash.slice(0, 8)}` : '';
          const ih = options.prompt && data.inputHash  ? `  inputHash=${data.inputHash.slice(0, 8)}`   : '';
          const cached = data.fromCache ? dim('  [cached]') : '';
          console.log(`  ${name.padEnd(10)} ${status}${model}${pv}${ph}${ih}${cached}`);
        }

        // Token usage
        const tokenRows = stages.filter((s) => s.data?.tokenUsage);
        if (tokenRows.length) {
          console.log(`\n${head('Token Usage')}`);
          let totalIn = 0, totalOut = 0;
          for (const { name, data } of tokenRows) {
            const u = data!.tokenUsage!;
            const inp = u.inputTokens ?? 0;
            const out = u.outputTokens ?? 0;
            totalIn += inp; totalOut += out;
            console.log(`  ${name.padEnd(10)} in=${inp.toLocaleString()}  out=${out.toLocaleString()}`);
          }
          console.log(dim(`  ${'Total'.padEnd(10)} in=${totalIn.toLocaleString()}  out=${totalOut.toLocaleString()}`));
        }

        // Evidence
        if (evidence?.length) {
          console.log(`\n${head('Evidence')} (${evidence.length} items)`);
          for (const ev of (evidence as Array<{ id: string; kind: string; path?: string; startLine?: number; command?: string; excerpt: string }>) ) {
            const loc = ev.path ? `  ${ev.path}${ev.startLine ? `:${ev.startLine}` : ''}` : ev.command ? `  cmd: ${ev.command}` : '';
            console.log(`  ${dim(ev.id)}  [${ev.kind}]${loc}`);
            console.log(`    ${ev.excerpt.slice(0, 100).replace(/\n/g, ' ')}`);
          }
        }

        // Files excluded note
        if (report?.attributableDiff?.truncated) {
          console.log(`\n${warn('Context was truncated')} — some files may not have been sent to the LLM.`);
          console.log(dim('  Run with --verbose to see which files were excluded.'));
        }

        console.log();
      } catch (err) {
        console.error('Error:', String(err));
        process.exit(1);
      }
    });
}

interface StageMeta {
  status?: string;
  model?: string;
  provider?: string;
  promptVersion?: string;
  promptHash?: string;
  inputHash?: string;
  fromCache?: boolean;
  tokenUsage?: { inputTokens?: number; outputTokens?: number };
}

interface ReportJson {
  attributableDiff?: {
    additions: number;
    deletions: number;
    commandIntroducedPaths: string[];
    preExistingPaths: string[];
    truncated: boolean;
  };
}
