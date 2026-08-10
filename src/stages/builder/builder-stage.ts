import type { VerificationStage, StageOutputWithMeta } from '../../core/pipeline/stage.js';
import type { RunContext } from '../../core/run/run-context.js';
import type { BuilderOutput, BuilderEvidence } from './builder-schema.js';
import type { ScoutOutput } from '../scout/scout-schema.js';
import { detectProject } from './project-detector.js';
import { planCommands } from './command-planner.js';
import { executeCommand } from './command-executor.js';
import { VerificationCache } from '../../core/cache/verification-cache.js';
import { sha256 } from '../../shared/hashing.js';

export interface BuilderInput {
  context: RunContext;
  scout?: ScoutOutput;
}

/**
 * Builder is deterministic — no LLM involved.
 * It detects the project, selects allowlisted commands, runs them,
 * captures bounded logs, and produces structured evidence.
 *
 * Scout's builderRecommendations are used for display context only.
 * The command planner always maps goals to allowlisted commands — LLM output
 * never reaches shell execution.
 *
 * Results are cached by (repoId + diff hash + command list). If the diff
 * hasn't changed and the commands haven't changed, skip re-running.
 */
export class BuilderStage implements VerificationStage<BuilderInput, BuilderOutput> {
  name = 'Builder';

  async execute(
    input: BuilderInput,
    _context: RunContext,
  ): Promise<StageOutputWithMeta<BuilderOutput>> {
    const { context } = input;
    const { repoRoot, config, repoId } = context;

    if (!config.builder.enabled) {
      return {
        output: {
          projectTypes: [],
          commands: [],
          overallStatus: 'skipped',
          evidence: [],
          limitations: ['Builder disabled in config'],
        },
        meta: { fromCache: false },
      };
    }

    const detection = detectProject(repoRoot);
    const extraCommands = config.builder.commands ?? [];
    const planned = planCommands(detection, extraCommands);

    if (planned.length === 0) {
      return {
        output: {
          projectTypes: detection.projectTypes,
          packageManager: detection.packageManager ?? undefined,
          commands: [],
          overallStatus: 'skipped',
          evidence: [],
          limitations: ['No runnable commands detected for this project type'],
        },
        meta: { fromCache: false },
      };
    }

    // Check verification cache
    const diffHash = sha256(context.diff?.patch ?? '');
    const cacheKey = VerificationCache.builderKey(
      repoId,
      diffHash,
      planned.map((p) => p.command),
    );
    const cached = await context.cache.get<BuilderOutput>(cacheKey, repoId);
    if (cached) {
      return { output: cached, meta: { fromCache: true } };
    }

    // Run commands
    const commandResults = [];
    for (let i = 0; i < planned.length; i++) {
      const result = await executeCommand(planned[i]!, repoRoot, config.builder.timeoutMs, i);
      commandResults.push(result);
    }

    // 'unavailable' is deliberately excluded: a tool that never ran is an
    // absence of evidence, not evidence of a defect. Surfacing it here would
    // let the Judge read a missing package manager as a broken build.
    const evidence: BuilderEvidence[] = commandResults
      .filter((r) => r.status === 'failed' || r.status === 'timed_out' || r.status === 'errored')
      .map((r, i) => ({
        kind: r.status === 'timed_out' ? 'timeout' : 'test-failure',
        summary: `${r.name} ${r.status}: ${r.stderrTail.slice(0, 200) || r.stdoutTail.slice(0, 200)}`,
        command: r.command,
        reference: `builder-command-${i}`,
      }));

    const unavailable = commandResults.filter((r) => r.status === 'unavailable');
    const ran = commandResults.filter((r) => r.status !== 'unavailable');

    const anyFailed = ran.some((r) => r.status === 'failed' || r.status === 'timed_out');
    const anyErrored = ran.some((r) => r.status === 'errored');
    const allPassed = ran.length > 0 && ran.every((r) => r.status === 'passed');

    const overallStatus = anyFailed
      ? 'failed'
      : anyErrored
        ? 'errored'
        : allPassed
          ? 'passed'
          : unavailable.length
            ? 'unavailable'
            : 'skipped';

    const limitations: string[] = [];
    if (unavailable.length) {
      const missing = [...new Set(unavailable.map((r) => r.command.split(' ')[0]))];
      limitations.push(
        `${unavailable.length} check(s) could not run — ${missing.join(', ')} not found on PATH. ` +
          `This is a missing tool, not a failing build: treat these checks as unverified rather than broken.`,
      );
    }

    const output: BuilderOutput = {
      projectTypes: detection.projectTypes,
      packageManager: detection.packageManager ?? undefined,
      commands: commandResults,
      overallStatus,
      evidence,
      limitations,
    };

    // Only cache passing or failed results — not errored/timed out
    if (overallStatus === 'passed' || overallStatus === 'failed') {
      await context.cache.set(cacheKey, repoId, output);
    }

    return { output, meta: { fromCache: false } };
  }
}
