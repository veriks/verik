import { customAlphabet } from 'nanoid';
import { mkdir } from 'node:fs/promises';
import { getRepositoryInfo } from '../repository/git-repository.js';
import { captureSnapshot } from '../repository/repository-snapshot.js';
import { computeDiff } from '../repository/diff-capture.js';
import { createTreeWorkspace } from '../repository/worktree-tree.js';
import { runCommand } from '../execution/command-runner.js';
import { runVerificationPipeline } from '../pipeline/verification-pipeline.js';
import { createRunRecord, finalizeRunRecord } from './run-state.js';
import { saveRunJson, saveRunFile, ensureRunDir } from '../../storage/local-run-store.js';
import { runDir } from '../../storage/paths.js';
import { loadConfig, loadPolicy } from '../../config/config-loader.js';
import { CommandSpawnError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { recordRun } from '../memory/memory-engine.js';
import { getOrCreateFingerprint } from '../repository/repo-fingerprint.js';
import { VerificationCache } from '../cache/verification-cache.js';
import { selectContext } from '../context/context-selector.js';
import { createProgress } from '../../cli/output/progress.js';
import { printVerificationSeparator } from '../../cli/output/terminal.js';
import { pruneOldRuns } from './run-pruner.js';
import type { RunFlags } from './run-context.js';
import type { RunContext } from './run-context.js';

const generateId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 20);

export function generateRunId(): string {
  return `ccr_${generateId()}`;
}

export interface OrchestratorResult {
  runId: string;
  exitCode: number;
  repoRoot: string;
  pipeline?: import('../pipeline/verification-pipeline.js').PipelineResult;
}

export async function orchestrateRun(
  wrappedCommand: string[],
  cwd: string,
  flags: RunFlags,
): Promise<OrchestratorResult> {
  const repoInfo = await getRepositoryInfo(cwd);
  const repoRoot = repoInfo.root;

  const [config, fingerprint] = await Promise.all([
    loadConfig(repoRoot),
    getOrCreateFingerprint(repoRoot, repoInfo.remote),
  ]);
  const policy = flags.policyPath
    ? await loadPolicy(flags.policyPath)
    : await loadPolicy(repoRoot);

  const runId = generateRunId();
  await ensureRunDir(repoRoot, runId);
  await mkdir(runDir(repoRoot, runId), { recursive: true });

  // The baseline tree is written before the wrapped command and read back after
  // it, so the workspace has to span the whole run — and be disposed on every
  // exit path, including a throw out of the command itself.
  const workspace = await createTreeWorkspace(repoRoot);

  try {
    const baseline = await captureSnapshot(
      repoRoot,
      workspace,
      'baseline',
      config.verification.includeUntrackedFiles,
    );

    let record = createRunRecord({
      runId,
      repositoryPath: repoRoot,
      repositoryRemote: repoInfo.remote,
      repoId: fingerprint.repoId,
      branch: repoInfo.branch,
      baselineCommitSha: repoInfo.commitSha,
      wrappedCommand,
      baselineSnapshot: baseline,
      repositoryDirtyBefore: repoInfo.isDirty,
    });

    await saveRunJson(repoRoot, runId, 'metadata.json', record);

    const abortController = new AbortController();
    let commandResult;
    try {
      commandResult = await runCommand(wrappedCommand, cwd, repoRoot, runId, abortController.signal);
    } catch (err) {
      throw new CommandSpawnError(`Failed to spawn command: ${String(err)}`);
    }

    // Print a clear separator so users can tell where the agent output ended
    // and Crosscheck verification begins. Skip in quiet/JSON mode.
    if (!flags.quiet && !flags.json) {
      printVerificationSeparator();
    }

    const finalSnapshot = await captureSnapshot(
      repoRoot,
      workspace,
      'final',
      config.verification.includeUntrackedFiles,
    );
    const diff = await computeDiff({
      root: repoRoot,
      workspace,
      baseline,
      final: finalSnapshot,
      maxDiffBytes: config.verification.maxDiffBytes,
      excludePatterns: config.privacy.excludePatterns,
    });

    record = finalizeRunRecord(record, {
      wrappedCommandExitCode: commandResult.exitCode,
      finalSnapshot,
      diff,
      repositoryDirtyAfter: finalSnapshot.dirty,
    });

    await saveRunJson(repoRoot, runId, 'metadata.json', record);
    // Raw, deliberately: `.crosscheck/runs/` is gitignored and local, and a
    // redacted forensic artifact is worse than useless when triaging a leak.
    await saveRunFile(repoRoot, runId, 'diff.patch', diff.patch);

    if (diff.changedFiles.length === 0 && !flags.verbose) {
      logger.info('Crosscheck: no repository changes detected.');
      const finalRecord = { ...record, status: 'completed' as const };
      await saveRunJson(repoRoot, runId, 'metadata.json', finalRecord);
      return { runId, exitCode: commandResult.exitCode, repoRoot };
    }

    if (diff.excludedFiles.length) {
      logger.debug(
        `Withheld ${diff.excludedFiles.length} file(s) from the model by privacy policy: ` +
          diff.excludedFiles.map((f) => f.path).join(', '),
      );
    }

    const cache = new VerificationCache(repoRoot);

    // Select context once here — stages read from context.selectedContext
    // instead of the raw diff, giving consistent token budgeting and redaction.
    const selectedContext = await selectContext({
      repoRoot,
      diff,
      maxDiffBytes: config.verification.maxDiffBytes,
      maxFileBytes: config.verification.maxFileBytes,
      maxTotalTokens: 60_000,
      excludePatterns: config.privacy.excludePatterns,
    });

    if (selectedContext.limitations.length) {
      logger.debug(`Context selector limitations: ${selectedContext.limitations.join('; ')}`);
    }

    const context: RunContext = {
      runId,
      repoRoot,
      repoId: fingerprint.repoId,
      config,
      policy,
      wrappedCommand,
      intent: flags.intent,
      baselineSnapshot: baseline,
      finalSnapshot,
      diff,
      selectedContext,
      record,
      flags,
      cache,
      progress: createProgress(flags.quiet || flags.json),
      abortSignal: abortController.signal,
    };

    const pipelineResult = await runVerificationPipeline(context);

    const { buildAndSaveReport } = await import('../../core/reports/report-builder.js');
    await buildAndSaveReport(context, pipelineResult);
    await recordRun(context, pipelineResult);

    const finalRecord = {
      ...record,
      status: 'completed' as const,
      stageStatuses: pipelineResult.stageStatuses,
      errors: pipelineResult.errors,
    };
    await saveRunJson(repoRoot, runId, 'metadata.json', finalRecord);

    // Prune old runs after writing — non-fatal, run silently.
    pruneOldRuns(repoRoot, config.runsToKeep).catch((err) =>
      logger.debug(`Run pruning failed (non-fatal): ${String(err)}`),
    );

    const exitCode = pipelineResult.policy?.exitCode ?? commandResult.exitCode;
    return { runId, exitCode, repoRoot, pipeline: pipelineResult };
  } finally {
    await workspace.dispose();
  }
}
