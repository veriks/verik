import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { writeCheckpointTree } from './worktree-tree.js';
import { logger } from '../../shared/logger.js';

/**
 * An explicit baseline, for agents that cannot be wrapped.
 *
 * `crosscheck run -- <cmd>` gets its baseline for free: snapshot before the
 * command, snapshot after. But an agent inside Cursor, Copilot or the Claude
 * desktop app is not a command there is any way to wrap, and `verify` alone
 * falls back to diffing against HEAD — which cannot tell the agent's work from
 * whatever the developer had already half-finished.
 *
 * A checkpoint restores exact attribution for those workflows. The tree is a
 * real git tree in Crosscheck's own object store, identical in kind to the one
 * the wrap path builds, so everything downstream is unchanged.
 */

const CheckpointSchema = z.object({
  version: z.literal(1),
  tree: z.string(),
  createdAt: z.string(),
  branch: z.string(),
  commitSha: z.string(),
});

export type Checkpoint = z.infer<typeof CheckpointSchema>;

const checkpointPath = (root: string): string => join(root, '.crosscheck', 'checkpoint.json');

export async function writeCheckpoint(
  root: string,
  branch: string,
  commitSha: string,
  includeUntracked: boolean,
): Promise<Checkpoint> {
  const tree = await writeCheckpointTree(root, includeUntracked);
  const checkpoint: Checkpoint = {
    version: 1,
    tree,
    createdAt: new Date().toISOString(),
    branch,
    commitSha,
  };
  await writeFile(checkpointPath(root), JSON.stringify(checkpoint, null, 2), 'utf8');
  return checkpoint;
}

export async function readCheckpoint(root: string): Promise<Checkpoint | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(checkpointPath(root), 'utf8'));
    return CheckpointSchema.parse(parsed);
  } catch {
    // Absent or unreadable is the normal case, not an error — most runs have
    // no checkpoint and correctly fall back to HEAD.
    return null;
  }
}

export async function clearCheckpoint(root: string): Promise<void> {
  await rm(checkpointPath(root), { force: true }).catch((err) =>
    logger.debug(`Could not clear checkpoint: ${String(err)}`),
  );
}

/**
 * A checkpoint taken on a different branch, or before a commit landed, is
 * describing a tree that no longer relates to what is in front of the user.
 * Diffing against it would attribute the branch switch to the agent.
 */
export function isStale(checkpoint: Checkpoint, branch: string, commitSha: string): boolean {
  return checkpoint.branch !== branch || checkpoint.commitSha !== commitSha;
}
