import { access, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { logger } from '../shared/logger.js';

/**
 * Moving `.crosscheck/` to `.verik/` when the tool was renamed.
 *
 * That directory is not scratch space — it holds the config, the policy, the
 * checkpoint, the durable object store the checkpoint tree lives in, and every
 * run record. A rename that ignored it would silently reset anyone who had
 * already adopted the tool: their baseline gone, their tuning gone, their
 * history orphaned, and no error to explain why.
 *
 * One directory rename, once, on first run. Both directories present means a
 * migration already happened and someone has since re-initialised — the newer
 * one wins and the old one is left alone rather than merged, because guessing
 * which policy file is authoritative is worse than leaving evidence behind.
 */

const LEGACY_DIR = '.crosscheck';
const CURRENT_DIR = '.verik';

const exists = async (p: string): Promise<boolean> => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

export async function migrateLegacyDir(repoRoot: string): Promise<boolean> {
  const legacy = join(repoRoot, LEGACY_DIR);
  const current = join(repoRoot, CURRENT_DIR);

  if (await exists(current)) return false;
  if (!(await exists(legacy))) return false;

  try {
    await rename(legacy, current);
    logger.debug(`Migrated ${LEGACY_DIR} to ${CURRENT_DIR}`);
    return true;
  } catch (err) {
    // Never fatal. A locked or read-only directory means this run behaves as a
    // fresh install, which is recoverable; crashing on startup is not.
    logger.debug(`Could not migrate ${LEGACY_DIR}: ${String(err)}`);
    return false;
  }
}

/**
 * Best-effort repository root, for running the migration before any command
 * has resolved one. Outside a repository there is nothing to migrate, and that
 * is not an error — `--version` and `--help` must work anywhere.
 */
export async function migrateIfNeeded(cwd: string): Promise<void> {
  try {
    const root = (await simpleGit(cwd).revparse(['--show-toplevel'])).trim();
    if (root) await migrateLegacyDir(root);
  } catch {
    // Not a repository. Nothing to do.
  }
}
