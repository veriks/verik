import type { PolicyResult } from '../policy/policy-schema.js';
import type { RunStatus, StageRunStatus } from './run-state.js';

/**
 * Resolves the process exit code and the persisted run status for a run.
 *
 * Previously this was `policy?.exitCode ?? commandResult.exitCode`, which had
 * two false-green failure modes:
 *
 *  - A policy verdict discarded the wrapped command's own exit code, so
 *    `verik run -- npm test` with failing tests exited 0 in advisory mode.
 *  - With no API key every LLM stage failed, so there was no policy at all, and
 *    the fallback returned the command's 0 while the run was still recorded as
 *    `completed` — reporting success for verification that never happened.
 *
 * Two independent signals therefore have to be combined: did the wrapped
 * command succeed, and did verification actually reach a verdict.
 */

export interface ExitDecision {
  exitCode: number;
  status: RunStatus;
  /** Set when the outcome is worth telling the user about explicitly. */
  warning?: string;
}

export interface ExitInputs {
  /** Exit code of the wrapped command, or null for `verify` (no command). */
  commandExitCode: number | null;
  policy?: PolicyResult;
  stageStatuses: Partial<Record<string, StageRunStatus>>;
  /** `shadow` promises to never affect the exit code. */
  policyMode: 'shadow' | 'advisory' | 'blocking';
  /**
   * `rules` runs only the deterministic rules and the Builder. It has no Judge
   * by design, so the absence of a verdict is success, not a failed run.
   */
  mode?: 'rules' | 'full';
}

/** A verdict requires the Judge to have actually produced one. */
function verificationReachedVerdict(inputs: ExitInputs): boolean {
  return inputs.policy !== undefined && inputs.stageStatuses['judge'] === 'completed';
}

export function resolveExit(inputs: ExitInputs): ExitDecision {
  const { commandExitCode, policy, policyMode } = inputs;
  const commandFailed = commandExitCode !== null && commandExitCode !== 0;
  const reachedVerdict = verificationReachedVerdict(inputs);

  // `rules` mode has no Judge by design, so the absence of a verdict is not a
  // failure — but it does have a policy decision now, and a blocking rule
  // finding must be able to stop the run. It still must not mask a failing
  // wrapped command.
  if (inputs.mode === 'rules') {
    if (policy && policy.exitCode !== 0) {
      return { exitCode: policy.exitCode, status: 'completed' };
    }
    return { exitCode: commandFailed ? commandExitCode : 0, status: 'completed' };
  }

  // Shadow mode's entire contract is that it never changes the exit code. It
  // still must not mask a failing wrapped command.
  if (policyMode === 'shadow') {
    return {
      exitCode: commandFailed ? commandExitCode : 0,
      status: reachedVerdict ? 'completed' : 'inconclusive',
    };
  }

  // A policy block is the strongest statement Verik can make: do not ship
  // this. It outranks the wrapped command's own code.
  if (policy && policy.exitCode === 2) {
    return { exitCode: 2, status: 'completed' };
  }

  // A failing wrapped command is a fact the user needs, whatever the verdict.
  if (commandFailed) {
    return {
      exitCode: commandExitCode,
      status: reachedVerdict ? 'completed' : 'inconclusive',
      warning: reachedVerdict
        ? undefined
        : 'The wrapped command failed and verification did not complete.',
    };
  }

  if (reachedVerdict) {
    return { exitCode: policy!.exitCode, status: 'completed' };
  }

  // Verification did not reach a verdict. Advisory promises never to fail a
  // build on Verik's opinion, so it stays 0 — but the run is recorded as
  // inconclusive rather than completed, and the user is told.
  return {
    exitCode: policyMode === 'blocking' ? 3 : 0,
    status: 'inconclusive',
    warning: 'Verification did not complete — this result does not mean the change is safe.',
  };
}
