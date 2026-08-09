import { Command } from 'commander';
import { orchestrateRun } from '../../core/run/run-orchestrator.js';
import { getRepositoryInfo } from '../../core/repository/git-repository.js';
import {
  printCommand,
  printVerdictSummary,
  printError,
  printJson,
} from '../output/terminal.js';
import { setVerbose } from '../../shared/logger.js';
import { CrosscheckError } from '../../shared/errors.js';
import type { RunFlags } from '../../core/run/run-context.js';

export function buildRunCommand(): Command {
  return new Command('run')
    .description('Run a command and verify its repository changes')
    .allowUnknownOption(false)
    .option('--json', 'Output machine-readable JSON')
    .option('--quiet', 'Suppress terminal output')
    .option('--verbose', 'Enable verbose logging')
    .option('--no-builder', 'Skip Builder stage')
    .option('--policy <path>', 'Path to policy.json')
    .option('--intent <text>', 'User intent description for better Scout analysis')
    .option('--model-scout <model>', 'Model override for Scout stage')
    .option('--model-reviewer <model>', 'Model override for Reviewer stage')
    .option('--model-judge <model>', 'Model override for Judge stage')
    .argument('<command...>', 'Command to run (after --)')
    .action(async (commandArgs: string[], options: Record<string, string | boolean>) => {
      const flags: RunFlags = {
        json: Boolean(options['json']),
        quiet: Boolean(options['quiet']),
        verbose: Boolean(options['verbose']),
        noBuilder: Boolean(options['noBuilder']),
        policyPath: options['policy'] as string | undefined,
        intent: options['intent'] as string | undefined,
        modelScout: options['modelScout'] as string | undefined,
        modelReviewer: options['modelReviewer'] as string | undefined,
        modelJudge: options['modelJudge'] as string | undefined,
      };

      if (flags.verbose) setVerbose(true);

      try {
        const cwd = process.cwd();
        await getRepositoryInfo(cwd);

        if (!flags.quiet && !flags.json) {
          printCommand(commandArgs);
        }

        const result = await orchestrateRun(commandArgs, cwd, flags);

        if (flags.json) {
          printJson({
            runId: result.runId,
            exitCode: result.exitCode,
            verdict: result.pipeline?.judge?.verdict,
            confidence: result.pipeline?.judge?.confidence,
          });
        } else if (!flags.quiet && result.pipeline) {
          printVerdictSummary(result.pipeline, result, flags.intent);
        }

        process.exit(result.exitCode);
      } catch (err) {
        if (err instanceof CrosscheckError) {
          if (!flags.quiet) printError(err.message);
          process.exit(err.exitCode);
        }
        if (!flags.quiet) printError(String(err));
        process.exit(1);
      }
    });
}
