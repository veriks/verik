import { readFile, writeFile, rm } from 'node:fs/promises';
import { simpleGit } from 'simple-git';
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
 * Whether a checkpoint still describes a meaningful comparison point.
 *
 * The first version treated *any* commit as invalidating — same branch, one
 * commit later, discard. That is backwards. Agents commit: Claude Code commits,
 * Aider commits by default, and the whole reason `begin` exists is to survive an
 * agent working unattended. Throwing the baseline away the moment the agent uses
 * it made the agent's work invisible, and `verify` reported "No changes to
 * verify" over two commits of real changes.
 *
 * The checkpoint tree is a real git object in Crosscheck's own store; it does
 * not stop being a valid diff target because HEAD moved forward. What genuinely
 * breaks it is HEAD moving *sideways* — checking out unrelated history, where
 * the diff would attribute someone else's commits to the agent.
 *
 * So the test is ancestry, not equality: if the checkpoint commit is an ancestor
 * of HEAD, everything between them happened after `begin` and belongs in the
 * diff. If it is not, the histories have diverged and the baseline is junk.
 */
export async function isStale(
  root: string,
  checkpoint: Checkpoint,
  commitSha: string,
): Promise<boolean> {
  // Nothing has moved. No git call needed, and this is the common case.
  if (checkpoint.commitSha === commitSha) return false;

  // An unborn HEAD on either side has no ancestry to test. A checkpoint taken
  // before the first commit stays valid until one lands.
  if (!checkpoint.commitSha || !commitSha) return false;

  // Ancestry is asked as a counting question rather than with
  // `merge-base --is-ancestor`, which answers purely through its exit code and
  // writes nothing to stdout — a shape simple-git does not reliably surface as
  // a rejection, so the check silently answered "not stale" for every input.
  //
  // Commits reachable from the checkpoint but not from HEAD. Zero means HEAD
  // already contains the checkpoint, i.e. it is an ancestor.
  try {
    const out = await simpleGit(root).raw([
      'rev-list',
      '--count',
      `${commitSha}..${checkpoint.commitSha}`,
    ]);
    return Number(out.trim()) !== 0;
  } catch {
    // Unreadable history — the checkpoint commit may have been gc'd or rewritten.
    return true;
  }
}

/** How many commits have landed since the checkpoint, for reporting. */
export async function commitsSince(root: string, checkpoint: Checkpoint): Promise<number> {
  if (!checkpoint.commitSha) return 0;
  try {
    const out = await simpleGit(root).raw(['rev-list', '--count', `${checkpoint.commitSha}..HEAD`]);
    return Number(out.trim()) || 0;
  } catch {
    return 0;
  }
}
