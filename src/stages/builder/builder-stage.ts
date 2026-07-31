import type { VerificationStage } from '../../core/pipeline/stage.js';
import type { RunContext } from '../../core/run/run-context.js';
import type { BuilderOutput, BuilderEvidence } from './builder-schema.js';
import type { ScoutOutput } from '../scout/scout-schema.js';
import { detectProject } from './project-detector.js';
import { planCommands } from './command-planner.js';
import { executeCommand } from './command-executor.js';

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
 */
export class BuilderStage implements VerificationStage<BuilderInput, BuilderOutput> {
  name = 'Builder';

  async execute(input: BuilderInput, _context: RunContext): Promise<BuilderOutput> {
    const { context } = input;
    const { repoRoot, config } = context;

    if (!config.builder.enabled) {
      return {
        projectTypes: [],
        commands: [],
        overallStatus: 'skipped',
        evidence: [],
        limitations: ['Builder disabled in config'],
      };
    }

    const detection = detectProject(repoRoot);
    const extraCommands = config.builder.commands ?? [];
    const planned = planCommands(detection, extraCommands);

    if (planned.length === 0) {
      return {
        projectTypes: detection.projectTypes,
        packageManager: detection.packageManager ?? undefined,
        commands: [],
        overallStatus: 'skipped',
        evidence: [],
        limitations: ['No runnable commands detected for this project type'],
      };
    }

    const commandResults = [];
    for (let i = 0; i < planned.length; i++) {
      const result = await executeCommand(planned[i]!, repoRoot, config.builder.timeoutMs, i);
      commandResults.push(result);
    }

    const evidence: BuilderEvidence[] = commandResults
      .filter((r) => r.status === 'failed' || r.status === 'timed_out' || r.status === 'errored')
      .map((r, i) => ({
        kind: r.status === 'timed_out' ? 'timeout' : 'test-failure',
        summary: `${r.name} ${r.status}: ${r.stderrTail.slice(0, 200) || r.stdoutTail.slice(0, 200)}`,
        command: r.command,
        reference: `builder-command-${i}`,
      }));

    const anyFailed = commandResults.some((r) => r.status === 'failed' || r.status === 'timed_out');
    const anyErrored = commandResults.some((r) => r.status === 'errored');
    const allPassed = commandResults.every((r) => r.status === 'passed');

    const overallStatus = anyFailed ? 'failed'
      : anyErrored ? 'errored'
      : allPassed ? 'passed'
      : 'skipped';

    return {
      projectTypes: detection.projectTypes,
      packageManager: detection.packageManager ?? undefined,
      commands: commandResults,
      overallStatus,
      evidence,
      limitations: [],
    };
  }
}
