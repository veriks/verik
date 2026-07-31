import { loadRunRecord } from '../../storage/local-run-store.js';
import { listRunIds } from '../../storage/local-run-store.js';
import type { RunRecord } from '../run/run-state.js';

export async function getLatestRunId(repoRoot: string): Promise<string | undefined> {
  const ids = await listRunIds(repoRoot);
  return ids[0];
}

export async function getRunRecord(repoRoot: string, runId: string): Promise<RunRecord> {
  return loadRunRecord(repoRoot, runId);
}
