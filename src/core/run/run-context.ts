import type { VerikConfig, PolicyConfig } from '../../config/config-schema.js';
import type { RepositorySnapshot } from '../repository/repository-snapshot.js';
import type { DiffResult } from '../repository/diff-capture.js';
import type { RunRecord } from './run-state.js';
import type { VerificationCache } from '../cache/verification-cache.js';
import type { SelectedContext } from '../context/context-selector.js';
import type { StageProgress } from '../../cli/output/progress.js';

export interface RunContext {
  runId: string;
  repoRoot: string;
  repoId: string;
  config: VerikConfig;
  policy: PolicyConfig;
  wrappedCommand: string[];
  intent?: string;
  baselineSnapshot: RepositorySnapshot;
  finalSnapshot?: RepositorySnapshot;
  diff?: DiffResult;
  selectedContext?: SelectedContext;
  record: RunRecord;
  flags: RunFlags;
  cache: VerificationCache;
  progress: StageProgress;
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
