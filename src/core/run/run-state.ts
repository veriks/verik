import { z } from 'zod';
import type { RepositorySnapshot } from '../repository/repository-snapshot.js';
import type { DiffResult } from '../repository/diff-capture.js';

export const RunStatusSchema = z.enum([
  'pending',
  'running',
  'verifying',
  'completed',
  'failed',
  'cancelled',
  'inconclusive',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const StageRunStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'inconclusive',
  'cancelled',
]);
export type StageRunStatus = z.infer<typeof StageRunStatusSchema>;

export interface RunRecord {
  runId: string;
  repoId: string;
  repositoryPath: string;
  repositoryRemote?: string;
  branch: string;
  baselineCommitSha: string;
  startedAt: string;
  finishedAt?: string;
  wrappedCommand: string[];
  wrappedCommandExitCode?: number;
  repositoryDirtyBefore: boolean;
  repositoryDirtyAfter?: boolean;
  baselineSnapshotHash: string;
  finalSnapshotHash?: string;
  changedFiles?: string[];
  /** Changes already present before the wrapped command ran. */
  preExistingChangedPaths?: string[];
  /** Changes attributable to the wrapped command only. */
  commandIntroducedPaths?: string[];
  status: RunStatus;
  stageStatuses: Partial<Record<'scout' | 'builder' | 'reviewer' | 'judge', StageRunStatus>>;
  policyMode?: string;
  errors: string[];
}

export function createRunRecord(params: {
  runId: string;
  repoId: string;
  repositoryPath: string;
  repositoryRemote?: string;
  branch: string;
  baselineCommitSha: string;
  wrappedCommand: string[];
  baselineSnapshot: RepositorySnapshot;
  repositoryDirtyBefore: boolean;
}): RunRecord {
  return {
    runId: params.runId,
    repoId: params.repoId,
    repositoryPath: params.repositoryPath,
    repositoryRemote: params.repositoryRemote,
    branch: params.branch,
    baselineCommitSha: params.baselineCommitSha,
    startedAt: new Date().toISOString(),
    wrappedCommand: params.wrappedCommand,
    repositoryDirtyBefore: params.repositoryDirtyBefore,
    baselineSnapshotHash: params.baselineSnapshot.hash,
    status: 'running',
    stageStatuses: {},
    errors: [],
  };
}

export function finalizeRunRecord(
  record: RunRecord,
  params: {
    wrappedCommandExitCode: number;
    finalSnapshot: RepositorySnapshot;
    diff: DiffResult;
    repositoryDirtyAfter: boolean;
  },
): RunRecord {
  return {
    ...record,
    finishedAt: new Date().toISOString(),
    wrappedCommandExitCode: params.wrappedCommandExitCode,
    finalSnapshotHash: params.finalSnapshot.hash,
    changedFiles: params.diff.changedFiles.map((f) => f.path),
    preExistingChangedPaths: params.diff.preExistingChangedPaths,
    commandIntroducedPaths: params.diff.commandIntroducedPaths,
    repositoryDirtyAfter: params.repositoryDirtyAfter,
    status: 'verifying',
  };
}
