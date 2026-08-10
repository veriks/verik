import { Command } from 'commander';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import { computeWorktreeDiff } from '../../core/repository/diff-capture.js';
import { loadConfig, loadPolicy } from '../../config/config-loader.js';
import { generateRunId } from '../../core/run/run-orchestrator.js';
import { createRunRecord } from '../../core/run/run-state.js';
import { ensureRunDir, saveRunJson } from '../../storage/local-run-store.js';
import type { RunContext, RunFlags } from '../../core/run/run-context.js';
import { runVerificationPipeline } from '../../core/pipeline/verification-pipeline.js';
import { buildAndSaveReport } from '../../core/reports/report-builder.js';
import { runDir } from '../../storage/paths.js';
import { join } from 'node:path';
import { getOrCreateFingerprint } from '../../core/repository/repo-fingerprint.js';
import { VerificationCache } from '../../core/cache/verification-cache.js';
import { selectContext } from '../../core/context/context-selector.js';
import { createProgress } from '../output/progress.js';
import { resolveExit } from '../../core/run/exit-code.js';

export function buildVerifyCommand(): Command {
  return new Command('verify')
    .description('Verify current uncommitted diff without running a command')
    .option('--json', 'Output JSON')
    .option('--quiet', 'Suppress output')
    .option('--intent <text>', 'User intent')
    .option(
      '--base <ref>',
      'Verify the range <ref>..HEAD instead of uncommitted changes (for CI, where the checkout is clean)',
    )
    .action(async (options: Record<string, string | boolean>) => {
      try {
        const cwd = process.cwd();
        const info = await getRepositoryInfo(cwd);
        const root = info.root;
        const [config, fingerprint] = await Promise.all([
          loadConfig(root),
          getOrCreateFingerprint(root, info.remote),
        ]);
        const policy = await loadPolicy(root);

        const { snapshot, diff } = await computeWorktreeDiff({
          root,
          maxDiffBytes: config.verification.maxDiffBytes,
          excludePatterns: config.privacy.excludePatterns,
          includeUntracked: config.verification.includeUntrackedFiles,
          baseRef: options['base'] as string | undefined,
        });

        if (diff.changedFiles.length === 0) {
          console.log('No changes to verify.');
          return;
        }

        const runId = generateRunId();
        await ensureRunDir(root, runId);

        const record = createRunRecord({
          runId,
          repoId: fingerprint.repoId,
          repositoryPath: root,
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

        const selectedContext = await selectContext({
          repoRoot: root,
          diff,
          maxDiffBytes: config.verification.maxDiffBytes,
          maxFileBytes: config.verification.maxFileBytes,
          maxTotalTokens: 60_000,
          excludePatterns: config.privacy.excludePatterns,
        });

        const context: RunContext = {
          runId,
          repoRoot: root,
          repoId: fingerprint.repoId,
          config,
          policy,
          wrappedCommand: ['crosscheck', 'verify'],
          intent: flags.intent,
          baselineSnapshot: snapshot,
          finalSnapshot: snapshot,
          diff,
          selectedContext,
          record,
          flags,
          cache: new VerificationCache(root),
          progress: createProgress(flags.quiet || flags.json),
          abortSignal: new AbortController().signal,
        };

        const pipeline = await runVerificationPipeline(context);
        await buildAndSaveReport(context, pipeline);

        // Same false-green trap as `run`: a missing verdict must not read as a pass.
        const exit = resolveExit({
          commandExitCode: null,
          policy: pipeline.policy,
          stageStatuses: pipeline.stageStatuses,
          policyMode: policy.mode,
        });
        await saveRunJson(root, runId, 'metadata.json', { ...record, status: exit.status });

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
        if (exit.warning && !flags.quiet) console.error(exit.warning);
        process.exit(exit.exitCode);
      } catch (err) {
        console.error('Error:', String(err));
        process.exit(1);
      }
    });
}
