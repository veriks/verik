import { customAlphabet } from 'nanoid';
import { mkdir } from 'node:fs/promises';
import { getRepositoryInfo } from '../repository/git-repository.js';
import { captureSnapshot } from '../repository/repository-snapshot.js';
import { computeDiff } from '../repository/diff-capture.js';
import { runCommand } from '../execution/command-runner.js';
import { runVerificationPipeline } from '../pipeline/verification-pipeline.js';
import { createRunRecord, finalizeRunRecord } from './run-state.js';
import { saveRunJson, saveRunFile, ensureRunDir } from '../../storage/local-run-store.js';
import { runDir } from '../../storage/paths.js';
import { loadConfig, loadPolicy } from '../../config/config-loader.js';
import { CommandSpawnError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { recordRun } from '../memory/memory-engine.js';
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
}

export async function orchestrateRun(
  wrappedCommand: string[],
  cwd: string,
  flags: RunFlags,
): Promise<OrchestratorResult> {
  const repoInfo = await getRepositoryInfo(cwd);
  const repoRoot = repoInfo.root;

  const config = await loadConfig(repoRoot);
  const policy = flags.policyPath
    ? await loadPolicy(flags.policyPath)
    : await loadPolicy(repoRoot);

  const runId = generateRunId();
  await ensureRunDir(repoRoot, runId);
  await mkdir(runDir(repoRoot, runId), { recursive: true });

  const baseline = await captureSnapshot(repoRoot, config.verification.maxFileBytes);

  let record = createRunRecord({
    runId,
    repositoryPath: repoRoot,
    repositoryRemote: repoInfo.remote,
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

  const finalSnapshot = await captureSnapshot(repoRoot, config.verification.maxFileBytes);
  const diff = await computeDiff(
    repoRoot, baseline, config.verification.maxDiffBytes, config.verification.includeUntrackedFiles,
  );

  record = finalizeRunRecord(record, {
    wrappedCommandExitCode: commandResult.exitCode,
    finalSnapshot,
    diff,
    repositoryDirtyAfter: !!(finalSnapshot.trackedChangedFiles.length || finalSnapshot.untrackedFiles.length),
  });

  await saveRunJson(repoRoot, runId, 'metadata.json', record);
  await saveRunFile(repoRoot, runId, 'diff.patch', diff.patch);

  if (diff.changedFiles.length === 0 && !flags.verbose) {
    logger.info('Crosscheck: no repository changes detected.');
    const finalRecord = { ...record, status: 'completed' as const };
    await saveRunJson(repoRoot, runId, 'metadata.json', finalRecord);
    return { runId, exitCode: commandResult.exitCode, repoRoot };
  }

  const context: RunContext = {
    runId, repoRoot, config, policy,
    wrappedCommand, intent: flags.intent,
    baselineSnapshot: baseline, finalSnapshot, diff,
    record, flags, abortSignal: abortController.signal,
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

  const exitCode = pipelineResult.policy?.exitCode ?? commandResult.exitCode;
  return { runId, exitCode, repoRoot };
}
