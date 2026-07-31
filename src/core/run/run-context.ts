import type { CrosscheckConfig, PolicyConfig } from '../../config/config-schema.js';
import type { RepositorySnapshot } from '../repository/repository-snapshot.js';
import type { DiffResult } from '../repository/diff-capture.js';
import type { RunRecord } from './run-state.js';

export interface RunContext {
  runId: string;
  repoRoot: string;
  config: CrosscheckConfig;
  policy: PolicyConfig;
  wrappedCommand: string[];
  intent?: string;
  baselineSnapshot: RepositorySnapshot;
  finalSnapshot?: RepositorySnapshot;
  diff?: DiffResult;
  record: RunRecord;
  flags: RunFlags;
  abortSignal: AbortSignal;
}

export interface RunFlags {
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  noBuilder: boolean;
  policyPath?: string;
  intent?: string;
  modelScout?: string;
  modelReviewer?: string;
  modelJudge?: string;
}
