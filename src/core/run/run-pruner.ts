import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runsDir } from '../../storage/paths.js';
import { logger } from '../../shared/logger.js';

/**
 * Delete oldest run directories beyond the configured keep limit.
 * Runs are sorted newest-first by directory name (IDs are time-prefixed).
 * This keeps `.verik/runs/` from growing forever.
 */
export async function pruneOldRuns(repoRoot: string, keepCount: number): Promise<void> {
  if (keepCount <= 0) return;
  const dir = runsDir(repoRoot);
  let entries: string[];
  try {
    const raw = await readdir(dir, { withFileTypes: true });
    entries = raw
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return; // runs dir doesn't exist yet
  }

  const toDelete = entries.slice(keepCount);
  if (toDelete.length === 0) return;

  logger.debug(`Pruning ${toDelete.length} old run(s) (keeping ${keepCount})`);
  for (const id of toDelete) {
    try {
      await rm(join(dir, id), { recursive: true, force: true });
    } catch (err) {
      logger.warn(`Could not prune run ${id}: ${String(err)}`);
    }
  }
}
