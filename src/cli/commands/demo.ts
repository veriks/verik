import { Command } from 'commander';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { buildFakeRecord, buildFakePipeline, buildFakeContext } from '../output/fake-data.js';
import { printHeader, printCommand, printChanges, printVerdictSummary } from '../output/terminal.js';
import { buildAndSaveReport } from '../../core/reports/report-builder.js';
import { saveRunJson } from '../../storage/local-run-store.js';
import { runDir } from '../../storage/paths.js';

export function buildDemoCommand(): Command {
  return new Command('demo')
    .description('Show a fake end-to-end run — no subprocess, no LLM, no network')
    .option('--json', 'Print machine-readable JSON output')
    .action(async (options: { json?: boolean }) => {
      const record = buildFakeRecord();
      const pipeline = buildFakePipeline();
      const context = buildFakeContext(record);

      // Save the report so the user can read it afterwards
      const dir = runDir(context.repoRoot, context.runId);
      await mkdir(dir, { recursive: true });
      await saveRunJson(context.repoRoot, context.runId, 'metadata.json', record);
      await buildAndSaveReport(context, pipeline);

      if (options.json) {
        console.log(JSON.stringify({ runId: context.runId, verdict: pipeline.judge?.verdict, policy: pipeline.policy }, null, 2));
        return;
      }

      const diff = context.diff!;

      printHeader(context.runId);
      printCommand(context.wrappedCommand);
      printChanges(diff.additions, diff.deletions, diff.changedFiles.length);
      printVerdictSummary(pipeline, {
        runId: context.runId,
        exitCode: pipeline.policy?.exitCode ?? 0,
        repoRoot: context.repoRoot,
      });

      const reportPath = join(runDir(context.repoRoot, context.runId), 'report.md');
      console.log('(This was a demo run — no commands or LLMs were invoked.)');
      console.log('Report written to:', reportPath);
    });
}
