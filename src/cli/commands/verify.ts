import { Command } from 'commander';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { captureSnapshot } from '../../core/repository/repository-snapshot.js';
import { computeDiff } from '../../core/repository/diff-capture.js';
import { loadConfig, loadPolicy } from '../../config/config-loader.js';
import { generateRunId } from '../../core/run/run-orchestrator.js';
import { createRunRecord } from '../../core/run/run-state.js';
import { ensureRunDir } from '../../storage/local-run-store.js';
import { saveRunJson } from '../../storage/local-run-store.js';
import type { RunContext, RunFlags } from '../../core/run/run-context.js';
import { runVerificationPipeline } from '../../core/pipeline/verification-pipeline.js';
import { buildAndSaveReport } from '../../core/reports/report-builder.js';
import { runDir } from '../../storage/paths.js';
import { join } from 'node:path';

export function buildVerifyCommand(): Command {
  return new Command('verify')
    .description('Verify current uncommitted diff without running a command')
    .option('--json', 'Output JSON')
    .option('--quiet', 'Suppress output')
    .option('--intent <text>', 'User intent')
    .action(async (options: Record<string, string | boolean>) => {
      try {
        const cwd = process.cwd();
        const info = await getRepositoryInfo(cwd);
        const root = info.root;
        const config = await loadConfig(root);
        const policy = await loadPolicy(root);

        const snapshot = await captureSnapshot(root, config.verification.maxFileBytes);
        const diff = await computeDiff(root, { ...snapshot, trackedChangedFiles: [], untrackedFiles: [] }, config.verification.maxDiffBytes, config.verification.includeUntrackedFiles);

        if (diff.changedFiles.length === 0) {
          console.log('No changes to verify.');
          return;
        }

        const runId = generateRunId();
        await ensureRunDir(root, runId);

        const record = createRunRecord({
          runId, repositoryPath: root,
          repositoryRemote: info.remote,
          branch: info.branch,
          baselineCommitSha: info.commitSha,
          wrappedCommand: ['crosscheck', 'verify'],
          baselineSnapshot: snapshot,
          repositoryDirtyBefore: info.isDirty,
        });

        const flags: RunFlags = {
          json: Boolean(options['json']),
          quiet: Boolean(options['quiet']),
          verbose: false,
          noBuilder: false,
          intent: options['intent'] as string | undefined,
        };

        const context: RunContext = {
          runId, repoRoot: root, config, policy,
          wrappedCommand: ['crosscheck', 'verify'],
          intent: flags.intent,
          baselineSnapshot: snapshot,
          finalSnapshot: snapshot,
          diff,
          record, flags,
          abortSignal: new AbortController().signal,
        };

        const pipeline = await runVerificationPipeline(context);
        await buildAndSaveReport(context, pipeline);
        await saveRunJson(root, runId, 'metadata.json', { ...record, status: 'completed' });

        const verdict = pipeline.judge?.verdict ?? 'inconclusive';
        if (!flags.quiet) {
          console.log(`Verdict: ${verdict.toUpperCase()}`);
          if (pipeline.judge) console.log(pipeline.judge.summary);
          const reportPath = join(runDir(root, runId), 'report.md');
          console.log('\nFull report:', reportPath);
        }
        if (flags.json) {
          console.log(JSON.stringify({ runId, verdict, policy: pipeline.policy }));
        }
        process.exit(pipeline.policy?.exitCode ?? 0);
      } catch (err) {
        console.error('Error:', String(err));
        process.exit(1);
      }
    });
}
